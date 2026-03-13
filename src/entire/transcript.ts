/**
 * Parses JSONL transcripts from different agents into normalized SessionEntry format.
 *
 * Each agent stores transcripts in its own format:
 * - Claude Code: JSONL with envelope wrapper { type, message: { role, content }, uuid, timestamp }
 * - Cursor: SQLite-derived entries
 * - Gemini CLI: JSONL with Gemini API format
 * - OpenCode: JSONL with OpenAI-compatible format
 *
 * This module normalizes all formats into a common SessionEntry structure.
 */

import type { AgentType, SessionEntry, EntryType } from "./types.js";

/**
 * Parse a JSONL transcript into normalized session entries.
 */
export function parseTranscript(
  content: string,
  agent?: AgentType,
): SessionEntry[] {
  const lines = content.trim().split("\n").filter(Boolean);
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    try {
      const raw = JSON.parse(line);
      const entry = normalizeEntry(raw, agent);
      if (entry) entries.push(entry);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Normalize a raw transcript entry based on agent type.
 */
function normalizeEntry(
  raw: Record<string, unknown>,
  agent?: AgentType,
): SessionEntry | null {
  // Claude Code envelope format (real transcripts): { type, message, uuid, timestamp }
  if (detectClaudeEnvelopeFormat(raw)) {
    return normalizeClaudeEnvelopeEntry(raw);
  }

  // Raw Anthropic API format (test fixtures, older transcripts): { role, content }
  if (agent === "Claude Code" || detectClaudeRawFormat(raw)) {
    return normalizeClaudeRawEntry(raw);
  }

  // Gemini CLI format
  if (agent === "Gemini CLI" || detectGeminiFormat(raw)) {
    return normalizeGeminiEntry(raw);
  }

  // Generic / OpenAI-compatible format (OpenCode, Copilot CLI)
  return normalizeGenericEntry(raw);
}

/**
 * Detect Claude Code envelope format (real transcripts from Claude Code sessions).
 * These have a top-level "type" field like "user", "assistant", "system", "progress"
 * and a nested "message" object with { role, content }.
 */
function detectClaudeEnvelopeFormat(raw: Record<string, unknown>): boolean {
  const type = raw.type as string;
  return (
    (type === "user" || type === "assistant" || type === "system" || type === "progress") &&
    "uuid" in raw
  );
}

/**
 * Detect raw Anthropic API message format (used in test fixtures).
 */
function detectClaudeRawFormat(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.role === "string" &&
    (raw.role === "user" || raw.role === "assistant") &&
    (Array.isArray(raw.content) || typeof raw.content === "string") &&
    !("message" in raw)
  );
}

/**
 * Detect Gemini CLI format.
 */
function detectGeminiFormat(raw: Record<string, unknown>): boolean {
  return "parts" in raw || raw.role === "model";
}

/**
 * Normalize a Claude Code envelope entry.
 *
 * Real Claude Code transcripts use an envelope format:
 * {
 *   type: "user" | "assistant" | "system" | "progress",
 *   message: { role: "user"|"assistant", content: string | ContentBlock[] },
 *   uuid: "...",
 *   timestamp: "...",
 *   sessionId: "...",
 *   parentUuid: "...",
 * }
 *
 * Types we care about:
 * - "user": user messages (message.content is the prompt text)
 * - "assistant": assistant responses (message.content is ContentBlock[])
 * - "system": system messages
 * - "progress": hook events, tool progress — skip these
 * - "file-history-snapshot": file snapshots — skip these
 * - "queue-operation": queue ops — skip these
 * - "last-prompt": session end marker — skip
 */
function normalizeClaudeEnvelopeEntry(raw: Record<string, unknown>): SessionEntry | null {
  const type = raw.type as string;
  const uuid = (raw.uuid as string) ?? "";
  const timestamp = raw.timestamp as string | undefined;

  // Skip non-message types
  if (type === "progress" || type === "file-history-snapshot" || type === "queue-operation" || type === "last-prompt") {
    return null;
  }

  const message = raw.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const role = message.role as string;
  const content = message.content;

  // Simple text content (common for user messages)
  if (typeof content === "string") {
    return {
      uuid,
      type: mapRole(type),
      timestamp,
      content,
    };
  }

  // Content block array (common for assistant messages)
  if (Array.isArray(content)) {
    const blocks = content as Array<Record<string, unknown>>;

    // Collect all entries from this message
    // A single assistant message can contain text + multiple tool_use blocks
    const toolBlocks = blocks.filter((b) => b.type === "tool_use");
    const resultBlocks = blocks.filter((b) => b.type === "tool_result");
    const textBlocks = blocks.filter((b) => b.type === "text" && b.text);

    // If there are tool_use blocks, return the first one
    // (multi-tool messages will lose some data, but this is MVP)
    if (toolBlocks.length > 0) {
      const tb = toolBlocks[0];
      return {
        uuid: (tb.id as string) ?? uuid,
        type: "tool",
        timestamp,
        content: `Tool: ${tb.name}`,
        toolName: tb.name as string,
        toolInput: tb.input,
        filesAffected: extractFilesFromToolInput(
          tb.name as string,
          tb.input as Record<string, unknown>,
        ),
      };
    }

    // Tool results
    if (resultBlocks.length > 0) {
      const rb = resultBlocks[0];
      const resultContent = typeof rb.content === "string"
        ? rb.content
        : JSON.stringify(rb.content);
      return {
        uuid: (rb.tool_use_id as string) ?? uuid,
        type: "tool",
        timestamp,
        content: resultContent,
        toolOutput: rb.content,
      };
    }

    // Text blocks
    if (textBlocks.length > 0) {
      return {
        uuid,
        type: mapRole(role || type),
        timestamp,
        content: textBlocks.map((b) => b.text).join("\n"),
      };
    }

    // Thinking blocks only — skip (contains signature data, not useful)
    const hasOnlyThinking = blocks.every((b) => b.type === "thinking" || b.type === "redacted_thinking");
    if (hasOnlyThinking) return null;
  }

  return null;
}

/**
 * Normalize a raw Anthropic API message (legacy/test format).
 */
function normalizeClaudeRawEntry(raw: Record<string, unknown>): SessionEntry | null {
  const role = raw.role as string;
  const uuid = (raw.id as string) ?? (raw.uuid as string) ?? "";

  // Simple text content
  if (typeof raw.content === "string") {
    return {
      uuid,
      type: mapRole(role),
      content: raw.content,
    };
  }

  // Content block array
  if (Array.isArray(raw.content)) {
    const blocks = raw.content as Array<Record<string, unknown>>;

    const toolBlock = blocks.find((b) => b.type === "tool_use");
    if (toolBlock) {
      return {
        uuid: (toolBlock.id as string) ?? uuid,
        type: "tool",
        content: `Tool: ${toolBlock.name}`,
        toolName: toolBlock.name as string,
        toolInput: toolBlock.input,
        filesAffected: extractFilesFromToolInput(
          toolBlock.name as string,
          toolBlock.input as Record<string, unknown>,
        ),
      };
    }

    const resultBlock = blocks.find((b) => b.type === "tool_result");
    if (resultBlock) {
      const content = typeof resultBlock.content === "string"
        ? resultBlock.content
        : JSON.stringify(resultBlock.content);
      return {
        uuid: (resultBlock.tool_use_id as string) ?? uuid,
        type: "tool",
        content,
        toolOutput: resultBlock.content,
      };
    }

    const textBlocks = blocks.filter((b) => b.type === "text");
    if (textBlocks.length > 0) {
      return {
        uuid,
        type: mapRole(role),
        content: textBlocks.map((b) => b.text).join("\n"),
      };
    }
  }

  return null;
}

/**
 * Normalize a Gemini CLI transcript entry.
 */
function normalizeGeminiEntry(raw: Record<string, unknown>): SessionEntry | null {
  const role = raw.role as string;
  const parts = raw.parts as Array<Record<string, unknown>> | undefined;

  if (!parts || parts.length === 0) return null;

  const textParts = parts.filter((p) => typeof p.text === "string");
  if (textParts.length > 0) {
    return {
      uuid: (raw.id as string) ?? "",
      type: role === "model" ? "assistant" : mapRole(role),
      content: textParts.map((p) => p.text).join("\n"),
    };
  }

  const fnCall = parts.find((p) => p.functionCall != null);
  if (fnCall) {
    const fc = fnCall.functionCall as Record<string, unknown>;
    return {
      uuid: (raw.id as string) ?? "",
      type: "tool",
      content: `Tool: ${fc.name}`,
      toolName: fc.name as string,
      toolInput: fc.args,
    };
  }

  return null;
}

/**
 * Normalize a generic/OpenAI-compatible entry.
 */
function normalizeGenericEntry(raw: Record<string, unknown>): SessionEntry | null {
  const role = raw.role as string | undefined;
  const content = raw.content as string | undefined;

  if (!role || content === undefined) return null;

  return {
    uuid: (raw.id as string) ?? "",
    type: mapRole(role),
    content: typeof content === "string" ? content : JSON.stringify(content),
  };
}

/**
 * Map agent-specific roles to our normalized EntryType.
 */
function mapRole(role: string): EntryType {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
    case "model":
      return "assistant";
    case "tool":
    case "function":
      return "tool";
    case "system":
      return "system";
    default:
      return "assistant";
  }
}

/**
 * Extract file paths from tool input for file-modifying tools.
 */
function extractFilesFromToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  if (!input) return [];

  const fileTools = ["Write", "Edit", "NotebookEdit", "mcp__acp__Write", "mcp__acp__Edit"];

  if (fileTools.includes(toolName)) {
    const filePath = input.file_path ?? input.filePath ?? input.path;
    if (typeof filePath === "string") return [filePath];
  }

  return [];
}

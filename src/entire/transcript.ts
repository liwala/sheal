/**
 * Parses JSONL transcripts from different agents into normalized SessionEntry format.
 *
 * Each agent stores transcripts in its own format:
 * - Claude Code: JSONL with Anthropic API message format
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
  // Claude Code format: Anthropic API messages
  if (agent === "Claude Code" || detectClaudeFormat(raw)) {
    return normalizeClaudeEntry(raw);
  }

  // Gemini CLI format
  if (agent === "Gemini CLI" || detectGeminiFormat(raw)) {
    return normalizeGeminiEntry(raw);
  }

  // Generic / OpenAI-compatible format (OpenCode, Copilot CLI)
  return normalizeGenericEntry(raw);
}

/**
 * Detect Claude Code transcript format.
 * Claude uses "role" + "content" with Anthropic content block structure.
 */
function detectClaudeFormat(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.role === "string" &&
    (raw.role === "user" || raw.role === "assistant") &&
    (Array.isArray(raw.content) || typeof raw.content === "string")
  );
}

/**
 * Detect Gemini CLI format.
 */
function detectGeminiFormat(raw: Record<string, unknown>): boolean {
  return "parts" in raw || raw.role === "model";
}

/**
 * Normalize a Claude Code transcript entry.
 *
 * Claude entries follow the Anthropic API format:
 * { "role": "user"|"assistant", "content": string | ContentBlock[] }
 *
 * Content blocks can be:
 * - { "type": "text", "text": "..." }
 * - { "type": "tool_use", "id": "...", "name": "...", "input": {...} }
 * - { "type": "tool_result", "tool_use_id": "...", "content": "..." }
 */
function normalizeClaudeEntry(raw: Record<string, unknown>): SessionEntry | null {
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

    // Tool use
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

    // Tool result
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

    // Text blocks
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

  // Extract text from parts
  const textParts = parts.filter((p) => typeof p.text === "string");
  if (textParts.length > 0) {
    return {
      uuid: (raw.id as string) ?? "",
      type: role === "model" ? "assistant" : mapRole(role),
      content: textParts.map((p) => p.text).join("\n"),
    };
  }

  // Function calls
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

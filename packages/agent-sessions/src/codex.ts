/**
 * Codex CLI session reader.
 *
 * Reads sessions from ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * Codex JSONL format:
 *   session_meta: { id, cwd, model_provider, cli_version, timestamp }
 *   response_item: { type: "message"|"function_call", role, content: [...] }
 *   event_msg: (events/progress)
 *   turn_context: (turn boundaries)
 */

import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Checkpoint, CheckpointInfo, CheckpointRoot, Session, SessionEntry } from "./types.js";

export interface CodexProject {
  slug: string;
  projectPath: string;
  name: string;
  sessionCount: number;
  lastModified: string;
}

export interface CodexSessionFile {
  id: string;
  path: string;
  cwd: string;
  timestamp: string;
  model?: string;
  cliVersion?: string;
  firstPrompt?: string;
}

export interface CodexTranscriptEntry {
  role: "user" | "assistant" | "system";
  content: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp?: string;
}

const CODEX_DIR = join(homedir(), ".codex", "sessions");

/**
 * Check if Codex sessions exist.
 */
export function hasCodexSessions(): boolean {
  return existsSync(CODEX_DIR);
}

/**
 * List all Codex sessions, grouped by project (cwd).
 */
export function listCodexProjects(): CodexProject[] {
  if (!hasCodexSessions()) return [];

  const sessionFiles = collectSessionFiles();
  // Group by cwd
  const byProject = new Map<string, CodexSessionFile[]>();

  for (const sf of sessionFiles) {
    const key = sf.cwd || "unknown";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(sf);
  }

  const projects: CodexProject[] = [];
  for (const [cwd, sessions] of byProject) {
    sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const name = cwd.split("/").filter(Boolean).pop() || cwd;
    projects.push({
      slug: `codex:${cwd}`,
      projectPath: cwd,
      name,
      sessionCount: sessions.length,
      lastModified: sessions[0]?.timestamp || "",
    });
  }

  projects.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return projects;
}

/**
 * List sessions for a Codex project path.
 */
export function listCodexSessionsForProject(projectPath: string): CheckpointInfo[] {
  const sessionFiles = collectSessionFiles().filter((sf) => sf.cwd === projectPath);
  sessionFiles.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return sessionFiles.map((sf) => ({
    checkpointId: sf.id,
    sessionId: sf.id,
    createdAt: sf.timestamp,
    filesTouched: [],
    agent: "Codex",
    sessionCount: 1,
    sessionIds: [sf.id],
    title: sf.firstPrompt,
  }));
}

/**
 * Load a single Codex session's full transcript by session ID.
 */
export function loadCodexSession(sessionId: string): { meta: CodexSessionFile; entries: CodexTranscriptEntry[] } | null {
  const files = collectSessionFiles();
  const file = files.find(f => f.id === sessionId);
  if (!file) return null;

  const content = readFileSync(file.path, "utf-8");
  const entries: CodexTranscriptEntry[] = [];

  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "response_item") {
        const p = obj.payload;
        if (p.type === "message" && Array.isArray(p.content)) {
          const texts = p.content
            .filter((c: any) => c.type === "input_text" || c.type === "output_text" || c.type === "text")
            .map((c: any) => c.text || "")
            .join("\n");
          if (texts.trim()) {
            entries.push({ role: p.role || "assistant", content: texts, timestamp: obj.timestamp });
          }
        } else if (p.type === "function_call") {
          entries.push({
            role: "assistant",
            content: "",
            toolName: p.name,
            toolInput: typeof p.arguments === "string" ? p.arguments.slice(0, 200) : JSON.stringify(p.arguments).slice(0, 200),
            timestamp: obj.timestamp,
          });
        } else if (p.type === "function_call_output") {
          entries.push({
            role: "system",
            content: typeof p.output === "string" ? p.output.slice(0, 500) : JSON.stringify(p.output).slice(0, 500),
            toolName: p.call_id,
            timestamp: obj.timestamp,
          });
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  return { meta: file, entries };
}

/**
 * Load a Codex session as a normalized Checkpoint for retro analysis.
 */
export function loadCodexSessionCheckpoint(
  sessionId: string,
  projectRoot?: string,
): Checkpoint | null {
  const files = collectSessionFiles();
  const file = files.find((f) => f.id === sessionId);
  if (!file) return null;

  if (projectRoot && resolve(file.cwd) !== resolve(projectRoot)) {
    return null;
  }

  const content = readFileSync(file.path, "utf-8");
  return codexSessionToCheckpoint(file, content);
}

/**
 * Convert raw Codex session content into the normalized Checkpoint shape.
 */
export function codexSessionToCheckpoint(meta: CodexSessionFile, content: string): Checkpoint {
  const transcript = parseCodexTranscript(content);
  const filesTouched = extractFilesTouched(transcript);

  const session: Session = {
    metadata: {
      checkpointId: meta.id,
      sessionId: meta.id,
      strategy: "codex-native",
      createdAt: meta.timestamp,
      checkpointsCount: 0,
      filesTouched,
      agent: "Codex",
      model: meta.model,
      cliVersion: meta.cliVersion,
    },
    transcript,
    prompts: transcript
      .filter((entry) => entry.type === "user")
      .map((entry) => entry.content),
  };

  const root: CheckpointRoot = {
    checkpointId: meta.id,
    strategy: "codex-native",
    checkpointsCount: 0,
    filesTouched,
    sessions: [],
  };

  return { root, sessions: [session] };
}

/**
 * Collect all session files from the dated directory structure.
 */
function collectSessionFiles(): CodexSessionFile[] {
  if (!existsSync(CODEX_DIR)) return [];

  const sessions: CodexSessionFile[] = [];

  try {
    for (const year of readdirSync(CODEX_DIR)) {
      const yearDir = join(CODEX_DIR, year);
      if (!statSync(yearDir).isDirectory()) continue;

      for (const month of readdirSync(yearDir)) {
        const monthDir = join(yearDir, month);
        if (!statSync(monthDir).isDirectory()) continue;

        for (const day of readdirSync(monthDir)) {
          const dayDir = join(monthDir, day);
          if (!statSync(dayDir).isDirectory()) continue;

          for (const file of readdirSync(dayDir)) {
            if (!file.endsWith(".jsonl")) continue;
            const path = join(dayDir, file);
            const meta = extractCodexMeta(path);
            if (meta) sessions.push(meta);
          }
        }
      }
    }
  } catch {
    // skip errors in traversal
  }

  return sessions;
}

function parseCodexTranscript(content: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  const toolCalls = new Map<string, {
    originalName: string;
    mappedName: string;
    input: unknown;
    filesAffected: string[];
  }>();

  for (const line of content.split("\n")) {
    if (!line) continue;

    try {
      const obj = JSON.parse(line);
      const timestamp = obj.timestamp as string | undefined;
      if (obj.type === "custom_tool_call") {
        const entry = normalizeCodexCustomToolCall(obj, timestamp);
        if (entry) entries.push(entry);
        continue;
      }

      if (obj.type !== "response_item") continue;

      const payload = obj.payload;
      if (!payload || typeof payload !== "object") continue;

      if (payload.type === "custom_tool_call") {
        const entry = normalizeCodexCustomToolCall(payload, timestamp);
        if (entry) entries.push(entry);
        continue;
      }

      if (payload.type === "message") {
        const entry = normalizeCodexMessage(payload, timestamp);
        if (entry) entries.push(entry);
        continue;
      }

      if (payload.type === "function_call") {
        const toolCall = normalizeCodexToolCall(payload, timestamp);
        if (!toolCall) continue;

        toolCalls.set(payload.call_id, toolCall.pending);
        if (toolCall.entry) {
          entries.push(toolCall.entry);
        }
        continue;
      }

      if (payload.type === "function_call_output") {
        const pending = toolCalls.get(payload.call_id);
        const output = typeof payload.output === "string"
          ? payload.output
          : JSON.stringify(payload.output);
        entries.push({
          uuid: payload.call_id ?? "",
          type: "tool",
          timestamp,
          content: output.slice(0, 1000),
          toolOutput: output.slice(0, 4000),
        });
        if (pending?.originalName !== "write_stdin") {
          toolCalls.delete(payload.call_id);
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

function normalizeCodexCustomToolCall(
  raw: Record<string, unknown>,
  timestamp?: string,
): SessionEntry | null {
  const originalName = typeof raw.name === "string" ? raw.name : "";
  const mappedName = mapCodexToolName(originalName);
  const input = normalizeCodexToolInput(originalName, { code: raw.input });
  const filesAffected = extractCodexFilesAffected(originalName, input);

  if (!mappedName) return null;
  return {
    uuid: typeof raw.call_id === "string" ? raw.call_id : "",
    type: "tool",
    timestamp,
    content: `Tool: ${mappedName}`,
    toolName: mappedName,
    toolInput: input,
    filesAffected,
  };
}

function normalizeCodexMessage(
  payload: Record<string, unknown>,
  timestamp?: string,
): SessionEntry | null {
  const role = payload.role;
  const content = payload.content;
  if ((role !== "user" && role !== "assistant") || !Array.isArray(content)) return null;

  const texts = content
    .filter((block): block is Record<string, unknown> =>
      !!block && typeof block === "object" &&
      (block.type === "input_text" || block.type === "output_text" || block.type === "text") &&
      typeof block.text === "string",
    )
    .map((block) => (block.text as string).trim())
    .filter(Boolean);

  if (role === "user") {
    const prompts = texts.filter((text) => !isInjectedContext(text));
    if (prompts.length === 0) return null;
    return {
      uuid: "",
      type: "user",
      timestamp,
      content: prompts.join("\n"),
    };
  }

  if (texts.length === 0) return null;
  return {
    uuid: "",
    type: "assistant",
    timestamp,
    content: texts.join("\n"),
  };
}

function normalizeCodexToolCall(
  payload: Record<string, unknown>,
  timestamp?: string,
): {
  entry: SessionEntry | null;
  pending: { originalName: string; mappedName: string; input: unknown; filesAffected: string[] };
} | null {
  const originalName = typeof payload.name === "string" ? payload.name : "";
  const rawInput = parseCodexArguments(payload.arguments);
  const mappedName = mapCodexToolName(originalName);
  const input = normalizeCodexToolInput(originalName, rawInput);
  const filesAffected = extractCodexFilesAffected(originalName, input);

  const pending = { originalName, mappedName, input, filesAffected };
  if (originalName === "write_stdin") {
    return { entry: null, pending };
  }

  return {
    pending,
    entry: {
      uuid: typeof payload.call_id === "string" ? payload.call_id : "",
      type: "tool",
      timestamp,
      content: `Tool: ${mappedName}`,
      toolName: mappedName,
      toolInput: input,
      filesAffected,
    },
  };
}

function parseCodexArguments(argumentsValue: unknown): unknown {
  if (typeof argumentsValue !== "string") return argumentsValue;
  try {
    return JSON.parse(argumentsValue);
  } catch {
    return argumentsValue;
  }
}

function mapCodexToolName(toolName: string): string {
  switch (toolName) {
    case "exec_command":
      return "Bash";
    case "apply_patch":
      return "Edit";
    case "view_image":
      return "Read";
    default:
      return toolName;
  }
}

function normalizeCodexToolInput(toolName: string, input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const record = input as Record<string, unknown>;

  switch (toolName) {
    case "exec_command":
      return {
        command: typeof record.cmd === "string" ? record.cmd : "",
        workdir: record.workdir,
      };
    case "write_stdin":
      return {
        sessionId: record.session_id,
        chars: record.chars,
      };
    case "apply_patch":
      return {
        patch: typeof record.code === "string" ? record.code : "",
      };
    default:
      return input;
  }
}

function extractCodexFilesAffected(toolName: string, input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;

  if (toolName === "apply_patch" && typeof record.patch === "string") {
    return extractFilesFromPatch(record.patch);
  }

  const path = record.path ?? record.filePath ?? record.file_path;
  return typeof path === "string" ? [path] : [];
}

function extractFilesFromPatch(patch: string): string[] {
  const files = new Set<string>();
  const matches = patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm);
  for (const match of matches) {
    const file = match[1]?.trim();
    if (file) files.add(file);
  }
  return [...files];
}

function extractFilesTouched(entries: SessionEntry[]): string[] {
  const files = new Set<string>();
  for (const entry of entries) {
    for (const file of entry.filesAffected ?? []) {
      files.add(file);
    }
  }
  return [...files];
}

/** Check if text looks like injected system context rather than a real user prompt. */
function isInjectedContext(text: string): boolean {
  // AGENTS.md / CLAUDE.md injection: "# AGENTS.md instructions for ..."
  if (/^#\s+(AGENTS|CLAUDE|Repository|Agent)/.test(text)) return true;
  // XML-wrapped context: <environment_context>, <permissions instructions>, <INSTRUCTIONS>
  if (/^<[a-zA-Z_]/.test(text)) return true;
  // System prompt style
  if (text.startsWith("You are")) return true;
  // Very long text is likely injected docs (real prompts are usually short)
  if (text.length > 2000) return true;
  return false;
}

/**
 * Extract metadata from first few lines of a Codex session JSONL.
 */
/** Read the first `maxBytes` of a file and return complete lines. */
function readHeadBytes(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    const raw = buf.toString("utf-8", 0, bytesRead);
    const lastNewline = raw.lastIndexOf("\n");
    return lastNewline >= 0 ? raw.slice(0, lastNewline) : raw;
  } finally {
    closeSync(fd);
  }
}

function extractCodexMeta(path: string): CodexSessionFile | null {
  try {
    const content = readHeadBytes(path, 64 * 1024);
    // Read enough lines to find user prompt past injected context (meta + developer + 2-3 injected + prompt)
    const lines = content.split("\n").slice(0, 20);

    let id = "";
    let cwd = "";
    let timestamp = "";
    let model: string | undefined;
    let cliVersion: string | undefined;
    let firstPrompt: string | undefined;

    for (const line of lines) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);

        if (obj.type === "session_meta") {
          const p = obj.payload;
          id = p.id || "";
          cwd = p.cwd || "";
          timestamp = p.timestamp || obj.timestamp || "";
          model = p.model_provider;
          cliVersion = p.cli_version;
        }

        // Find first real user prompt
        if (!firstPrompt && obj.type === "response_item") {
          const p = obj.payload;
          if (p.role === "user" && Array.isArray(p.content)) {
            for (const block of p.content) {
              if (block.type === "input_text" && typeof block.text === "string") {
                const text = block.text.trim();
                if (text.length > 5 && !isInjectedContext(text)) {
                  firstPrompt = text.split("\n")[0].slice(0, 80);
                  break;
                }
              }
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    if (!id) return null;

    return { id, path, cwd, timestamp, model, cliVersion, firstPrompt };
  } catch {
    return null;
  }
}

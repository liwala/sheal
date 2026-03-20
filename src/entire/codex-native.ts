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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CheckpointInfo } from "./types.js";

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
function extractCodexMeta(path: string): CodexSessionFile | null {
  try {
    const content = readFileSync(path, "utf-8");
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

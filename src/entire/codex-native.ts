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

/**
 * Extract metadata from first few lines of a Codex session JSONL.
 */
function extractCodexMeta(path: string): CodexSessionFile | null {
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").slice(0, 50); // Read more lines to find user prompt

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
                // Skip injected context (AGENTS.md, system prompts, etc.)
                if (text.length > 5 && text.length < 500 &&
                    !text.startsWith("#") && !text.startsWith("<") &&
                    !text.startsWith("You are")) {
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

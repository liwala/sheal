/**
 * Gemini CLI session reader.
 *
 * Reads sessions from ~/.gemini/tmp/<project>/chats/session-*.json
 *
 * Project directories use either:
 *   - Named directories (e.g., "my-project") with a .project_root file
 *   - SHA-256 hash of the absolute project path
 *
 * ~/.gemini/projects.json maps absolute paths to project names.
 *
 * Session JSON format:
 *   { sessionId, projectHash, startTime, lastUpdated, messages: [...] }
 *
 * Message types:
 *   - { type: "user", content: [{text}] | string }
 *   - { type: "gemini", content: string, toolCalls?: [...], tokens?: {...}, model?: string }
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { CheckpointInfo } from "./types.js";

const GEMINI_TMP = join(homedir(), ".gemini", "tmp");
const GEMINI_PROJECTS = join(homedir(), ".gemini", "projects.json");

export interface GeminiProject {
  slug: string;
  projectPath: string;
  name: string;
  sessionCount: number;
  lastModified: string;
}

export interface GeminiSessionFile {
  id: string;
  path: string;
  projectPath: string;
  startTime: string;
  lastUpdated: string;
  model?: string;
  firstPrompt?: string;
}

export interface GeminiTranscriptEntry {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp?: string;
  tokens?: { input: number; output: number };
}

export function hasGeminiSessions(): boolean {
  return existsSync(GEMINI_TMP);
}

/**
 * Load the projects.json path→name mapping.
 */
function loadProjectsMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(GEMINI_PROJECTS)) return map;
  try {
    const raw = JSON.parse(readFileSync(GEMINI_PROJECTS, "utf-8"));
    if (raw.projects && typeof raw.projects === "object") {
      for (const [path, name] of Object.entries(raw.projects)) {
        if (typeof name === "string") map.set(path, name);
      }
    }
  } catch {
    // skip
  }
  return map;
}

/**
 * List all Gemini projects with sessions.
 */
export function listGeminiProjects(): GeminiProject[] {
  if (!hasGeminiSessions()) return [];

  const projectsMap = loadProjectsMap();
  const projects: GeminiProject[] = [];

  try {
    for (const dirName of readdirSync(GEMINI_TMP)) {
      const dirPath = join(GEMINI_TMP, dirName);
      if (!statSync(dirPath).isDirectory()) continue;

      const chatsDir = join(dirPath, "chats");
      if (!existsSync(chatsDir)) continue;

      const projectPath = resolveProjectPathSync(dirName, dirPath, projectsMap);
      if (!projectPath) continue;

      const sessionFiles = readdirSync(chatsDir).filter((f) => f.endsWith(".json"));
      if (sessionFiles.length === 0) continue;

      // Get last modified from most recent session filename
      const sorted = sessionFiles.sort().reverse();
      let lastModified = "";
      try {
        const stat = statSync(join(chatsDir, sorted[0]));
        lastModified = stat.mtime.toISOString();
      } catch {
        // skip
      }

      const name = basename(projectPath);
      projects.push({
        slug: `gemini:${projectPath}`,
        projectPath,
        name,
        sessionCount: sessionFiles.length,
        lastModified,
      });
    }
  } catch {
    // skip errors
  }

  // Deduplicate projects that resolve to the same path (e.g. named + hash dirs)
  const byPath = new Map<string, GeminiProject>();
  for (const p of projects) {
    const existing = byPath.get(p.projectPath);
    if (existing) {
      existing.sessionCount += p.sessionCount;
      if (p.lastModified > existing.lastModified) existing.lastModified = p.lastModified;
    } else {
      byPath.set(p.projectPath, p);
    }
  }

  const deduped = [...byPath.values()];
  deduped.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return deduped;
}

/**
 * Synchronous version of resolveProjectPath (avoids top-level await issues).
 */
function resolveProjectPathSync(dirName: string, dirPath: string, projectsMap: Map<string, string>): string | null {
  // Named directory with .project_root file
  const rootFile = join(dirPath, ".project_root");
  if (existsSync(rootFile)) {
    try {
      return readFileSync(rootFile, "utf-8").trim();
    } catch {
      // fall through
    }
  }

  // Reverse lookup from projects.json — name matches
  for (const [absPath, name] of projectsMap) {
    if (name === dirName) return absPath;
  }

  // Skip non-project directories (like "bin")
  if (!/^[a-f0-9]{64}$/.test(dirName) && !existsSync(join(dirPath, "chats"))) {
    return null;
  }

  // For hash-based dirs, reverse lookup using crypto
  try {
    const crypto = require("node:crypto");
    for (const [absPath] of projectsMap) {
      const hash = crypto.createHash("sha256").update(absPath).digest("hex");
      if (hash === dirName) return absPath;
    }
  } catch {
    // skip
  }

  return null;
}

/**
 * List sessions for a specific project path.
 */
export function listGeminiSessionsForProject(projectPath: string): CheckpointInfo[] {
  if (!hasGeminiSessions()) return [];

  const projectsMap = loadProjectsMap();
  const sessions: CheckpointInfo[] = [];

  try {
    for (const dirName of readdirSync(GEMINI_TMP)) {
      const dirPath = join(GEMINI_TMP, dirName);
      if (!statSync(dirPath).isDirectory()) continue;

      const resolved = resolveProjectPathSync(dirName, dirPath, projectsMap);
      if (resolved !== projectPath) continue;

      const chatsDir = join(dirPath, "chats");
      if (!existsSync(chatsDir)) continue;

      for (const file of readdirSync(chatsDir).filter((f) => f.endsWith(".json"))) {
        const meta = extractGeminiMeta(join(chatsDir, file), projectPath);
        if (meta) {
          sessions.push({
            checkpointId: meta.id,
            sessionId: meta.id,
            createdAt: meta.startTime,
            filesTouched: [],
            agent: "Gemini",
            sessionCount: 1,
            sessionIds: [meta.id],
            title: meta.firstPrompt,
          });
        }
      }
      // Don't break — there may be both named and hash dirs for the same project
    }
  } catch {
    // skip
  }

  // Deduplicate sessions (same session may appear in both named and hash dirs)
  const seen = new Set<string>();
  const deduped = sessions.filter((s) => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });
  deduped.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return deduped;
}

/**
 * Load a full Gemini session transcript.
 */
export function loadGeminiSession(sessionId: string): { meta: GeminiSessionFile; entries: GeminiTranscriptEntry[] } | null {
  if (!hasGeminiSessions()) return null;

  // Search all project dirs for this session
  try {
    for (const dirName of readdirSync(GEMINI_TMP)) {
      const chatsDir = join(GEMINI_TMP, dirName, "chats");
      if (!existsSync(chatsDir)) continue;

      for (const file of readdirSync(chatsDir).filter((f) => f.endsWith(".json"))) {
        const filePath = join(chatsDir, file);
        try {
          const raw = JSON.parse(readFileSync(filePath, "utf-8"));
          if (raw.sessionId !== sessionId) continue;

          const projectsMap = loadProjectsMap();
          const dirPath = join(GEMINI_TMP, dirName);
          const projectPath = resolveProjectPathSync(dirName, dirPath, projectsMap) || "";

          const entries = parseGeminiMessages(raw.messages || []);
          const firstPrompt = extractFirstPrompt(raw.messages || []);

          return {
            meta: {
              id: raw.sessionId,
              path: filePath,
              projectPath,
              startTime: raw.startTime || "",
              lastUpdated: raw.lastUpdated || "",
              model: findModel(raw.messages || []),
              firstPrompt,
            },
            entries,
          };
        } catch {
          // skip malformed files
        }
      }
    }
  } catch {
    // skip
  }

  return null;
}

/**
 * Extract lightweight metadata from a session file without fully parsing it.
 */
function extractGeminiMeta(filePath: string, projectPath: string): GeminiSessionFile | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const raw = JSON.parse(content);

    return {
      id: raw.sessionId || "",
      path: filePath,
      projectPath,
      startTime: raw.startTime || "",
      lastUpdated: raw.lastUpdated || "",
      model: findModel(raw.messages || []),
      firstPrompt: extractFirstPrompt(raw.messages || []),
    };
  } catch {
    return null;
  }
}

/**
 * Extract the first user prompt from messages.
 */
function extractFirstPrompt(messages: any[]): string | undefined {
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const text = extractUserText(msg);
    if (text && text.length > 3) {
      return text.split("\n")[0].slice(0, 80);
    }
  }
  return undefined;
}

/**
 * Extract text from a user message (handles both string and array content).
 */
function extractUserText(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
  }
  return "";
}

/**
 * Find the model from the first gemini message with a model field.
 */
function findModel(messages: any[]): string | undefined {
  for (const msg of messages) {
    if (msg.type === "gemini" && msg.model) return msg.model;
  }
  return undefined;
}

/**
 * Parse all messages into transcript entries.
 */
function parseGeminiMessages(messages: any[]): GeminiTranscriptEntry[] {
  const entries: GeminiTranscriptEntry[] = [];

  for (const msg of messages) {
    if (msg.type === "user") {
      const text = extractUserText(msg);
      if (text.trim()) {
        entries.push({
          role: "user",
          content: text,
          timestamp: msg.timestamp,
        });
      }
    } else if (msg.type === "gemini") {
      // Tool calls first
      if (Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          const output = tc.result?.[0]?.functionResponse?.response?.output;
          entries.push({
            role: "tool",
            content: "",
            toolName: tc.displayName || tc.name,
            toolInput: typeof tc.args === "object" ? JSON.stringify(tc.args).slice(0, 200) : String(tc.args || "").slice(0, 200),
            toolOutput: typeof output === "string" ? output.slice(0, 500) : undefined,
            timestamp: tc.timestamp || msg.timestamp,
          });
        }
      }

      // Assistant text
      if (typeof msg.content === "string" && msg.content.trim()) {
        entries.push({
          role: "assistant",
          content: msg.content,
          timestamp: msg.timestamp,
          tokens: msg.tokens ? { input: msg.tokens.input, output: msg.tokens.output } : undefined,
        });
      }
    }
  }

  return entries;
}

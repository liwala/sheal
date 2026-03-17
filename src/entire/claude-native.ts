/**
 * Native Claude Code transcript reader.
 *
 * Reads session transcripts directly from ~/.claude/projects/<project-slug>/
 * when Entire.io is not available. This provides a fallback so sheal retro
 * works without Entire.io installed.
 *
 * Claude Code stores sessions as:
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * The project slug is the absolute path with / replaced by -.
 * Each JSONL line is a Claude Code envelope entry with:
 *   { type, message, uuid, timestamp, sessionId, version, cwd, ... }
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseTranscript } from "./transcript.js";
import type {
  Checkpoint,
  CheckpointInfo,
  CheckpointRoot,
  Session,
  SessionMetadata,
  TokenUsage,
} from "./types.js";

/**
 * Derive the Claude Code project directory path for a given project root.
 * Claude Code uses the format: ~/.claude/projects/-<path-with-dashes>/
 */
export function getClaudeProjectDir(projectRoot: string): string | null {
  const absPath = resolve(projectRoot);
  // Claude Code slug: absolute path with / replaced by -
  // e.g., /Users/lu/code/foo → -Users-lu-code-foo
  const slug = absPath.replace(/\//g, "-");
  const dir = join(homedir(), ".claude", "projects", slug);
  return existsSync(dir) ? dir : null;
}

/**
 * Check if native Claude Code transcripts are available for this project.
 */
export function hasNativeTranscripts(projectRoot: string): boolean {
  const dir = getClaudeProjectDir(projectRoot);
  if (!dir) return false;

  // Check for at least one .jsonl file
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  return files.length > 0;
}

/**
 * List available sessions from native Claude Code transcripts.
 * Returns CheckpointInfo[] to match the Entire.io reader interface.
 * Each session becomes its own "checkpoint" since there's no checkpoint concept natively.
 */
export function listNativeSessions(projectRoot: string): CheckpointInfo[] {
  const dir = getClaudeProjectDir(projectRoot);
  if (!dir) return [];

  const jsonlFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f,
      sessionId: f.replace(".jsonl", ""),
      path: join(dir, f),
    }));

  const sessions: CheckpointInfo[] = [];

  for (const file of jsonlFiles) {
    try {
      const stat = statSync(file.path);
      // Read first few lines to extract metadata
      const meta = extractSessionMeta(file.path);

      sessions.push({
        checkpointId: file.sessionId,
        sessionId: file.sessionId,
        createdAt: meta.createdAt || stat.mtime.toISOString(),
        filesTouched: [],
        agent: "Claude Code",
        sessionCount: 1,
        sessionIds: [file.sessionId],
        title: meta.firstPrompt,
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort most recent first
  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return sessions;
}

/**
 * Extract basic metadata from the first few lines of a session JSONL.
 */
function extractSessionMeta(path: string): {
  createdAt: string;
  model?: string;
  version?: string;
  totalTokens?: TokenUsage;
  firstPrompt?: string;
} {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let createdAt = "";
  let model: string | undefined;
  let version: string | undefined;
  let firstPrompt: string | undefined;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let apiCalls = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Get earliest timestamp
      if (obj.timestamp && (!createdAt || obj.timestamp < createdAt)) {
        createdAt = obj.timestamp;
      }

      // Get first real user prompt as session title
      if (!firstPrompt && obj.type === "user") {
        const text = extractUserText(obj);
        if (text) {
          firstPrompt = text.split("\n")[0].slice(0, 80);
        }
      }

      // Get model and version from first assistant message
      if (obj.type === "assistant" && obj.message) {
        if (!model && obj.message.model) model = obj.message.model;
        if (!version && obj.version) version = obj.version;

        // Accumulate token usage
        const usage = obj.message.usage;
        if (usage) {
          totalInput += usage.input_tokens ?? 0;
          totalOutput += usage.output_tokens ?? 0;
          totalCacheRead += usage.cache_read_input_tokens ?? 0;
          totalCacheCreate += usage.cache_creation_input_tokens ?? 0;
          apiCalls++;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  const totalTokens: TokenUsage | undefined = apiCalls > 0 ? {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreate,
    apiCallCount: apiCalls,
  } : undefined;

  return { createdAt, model, version, totalTokens, firstPrompt };
}

/**
 * Load a native Claude Code session as a Checkpoint.
 * Maps the native format to our Checkpoint/Session types.
 */
export function loadNativeSession(
  projectRoot: string,
  sessionId: string,
): Checkpoint | null {
  const dir = getClaudeProjectDir(projectRoot);
  if (!dir) return null;

  const path = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8");
  const meta = extractSessionMeta(path);
  const transcript = parseTranscript(content, "Claude Code");

  // Build Session
  const session: Session = {
    metadata: {
      checkpointId: sessionId,
      sessionId,
      strategy: "native",
      createdAt: meta.createdAt,
      checkpointsCount: 0,
      filesTouched: extractFilesTouched(transcript),
      agent: "Claude Code",
      model: meta.model,
      tokenUsage: meta.totalTokens,
    },
    transcript,
    prompts: transcript
      .filter((e) => e.type === "user")
      .map((e) => e.content),
  };

  // Build CheckpointRoot
  const root: CheckpointRoot = {
    checkpointId: sessionId,
    strategy: "native",
    checkpointsCount: 0,
    filesTouched: session.metadata.filesTouched,
    sessions: [],
    tokenUsage: meta.totalTokens,
  };

  return { root, sessions: [session] };
}

/**
 * Info about a discovered Claude Code project.
 */
export interface NativeProject {
  /** The slug used as directory name (e.g. -Users-lu-code-foo) */
  slug: string;
  /** Reconstructed absolute path (e.g. /Users/lu/code/foo) */
  projectPath: string;
  /** Short display name (last path component) */
  name: string;
  /** Number of .jsonl session files */
  sessionCount: number;
  /** Most recent session modification time */
  lastModified: string;
}

/**
 * List all Claude Code projects that have session transcripts.
 * Scans ~/.claude/projects/ for directories containing .jsonl files.
 */
export function listAllNativeProjects(): NativeProject[] {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return [];

  const projects: NativeProject[] = [];

  for (const slug of readdirSync(projectsDir)) {
    const dir = join(projectsDir, slug);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }

    const jsonlFiles = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) continue;

    // Extract the real project path from the cwd field of the first session line.
    // The slug is lossy (can't distinguish path separators from hyphens in dir names).
    const projectPath = extractProjectPath(dir, jsonlFiles) || slug;
    const name = projectPath.split("/").filter(Boolean).pop() || slug;

    // Find most recent session
    let lastModified = "";
    for (const f of jsonlFiles) {
      try {
        const mtime = statSync(join(dir, f)).mtime.toISOString();
        if (!lastModified || mtime > lastModified) lastModified = mtime;
      } catch {
        // skip
      }
    }

    projects.push({
      slug,
      projectPath,
      name,
      sessionCount: jsonlFiles.length,
      lastModified,
    });
  }

  // Sort by most recently active
  projects.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return projects;
}

/**
 * List sessions for a project identified by its slug (from listAllNativeProjects).
 */
export function listNativeSessionsBySlug(slug: string): CheckpointInfo[] {
  const dir = join(homedir(), ".claude", "projects", slug);
  if (!existsSync(dir)) return [];

  const jsonlFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f,
      sessionId: f.replace(".jsonl", ""),
      path: join(dir, f),
    }));

  const sessions: CheckpointInfo[] = [];

  for (const file of jsonlFiles) {
    try {
      const stat = statSync(file.path);
      const meta = extractSessionMeta(file.path);

      sessions.push({
        checkpointId: file.sessionId,
        sessionId: file.sessionId,
        createdAt: meta.createdAt || stat.mtime.toISOString(),
        filesTouched: [],
        agent: "Claude Code",
        sessionCount: 1,
        sessionIds: [file.sessionId],
        title: meta.firstPrompt,
      });
    } catch {
      // skip
    }
  }

  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sessions;
}

/**
 * Load a session by slug + sessionId (for global mode where we don't have a project root).
 */
export function loadNativeSessionBySlug(
  slug: string,
  sessionId: string,
): Checkpoint | null {
  const dir = join(homedir(), ".claude", "projects", slug);
  const path = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8");
  const meta = extractSessionMeta(path);
  const transcript = parseTranscript(content, "Claude Code");

  const session: Session = {
    metadata: {
      checkpointId: sessionId,
      sessionId,
      strategy: "native",
      createdAt: meta.createdAt,
      checkpointsCount: 0,
      filesTouched: extractFilesTouched(transcript),
      agent: "Claude Code",
      model: meta.model,
      tokenUsage: meta.totalTokens,
    },
    transcript,
    prompts: transcript
      .filter((e) => e.type === "user")
      .map((e) => e.content),
  };

  const root: CheckpointRoot = {
    checkpointId: sessionId,
    strategy: "native",
    checkpointsCount: 0,
    filesTouched: session.metadata.filesTouched,
    sessions: [],
    tokenUsage: meta.totalTokens,
  };

  return { root, sessions: [session] };
}

/**
 * Extract meaningful user text from a user-type JSONL entry.
 * Handles both plain string content and content block arrays.
 * Returns null for tool_results, system-injected content, and other non-prompt messages.
 */
function extractUserText(obj: Record<string, unknown>): string | null {
  const msg = obj.message as Record<string, unknown> | undefined;
  const content = msg?.content ?? obj.content;

  // Plain string content
  if (typeof content === "string") {
    return isUsefulPrompt(content) ? content : null;
  }

  // Content block array — look for text blocks, skip tool_results
  if (Array.isArray(content)) {
    const blocks = content as Array<Record<string, unknown>>;

    // If it contains tool_result blocks, it's not a user prompt
    if (blocks.some((b) => b.type === "tool_result")) return null;

    // Extract text from text blocks
    const textParts = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);

    if (textParts.length === 0) return null;
    const text = textParts.join(" ");
    return isUsefulPrompt(text) ? text : null;
  }

  return null;
}

/**
 * Check if a text string looks like a real user prompt (not system/hook content).
 */
function isUsefulPrompt(text: string): boolean {
  if (text.length < 6) return false;
  if (text.startsWith("-\n")) return false;        // piped stdin prompt
  if (text.startsWith("<")) return false;           // XML/HTML tags (system)
  if (text.startsWith("#")) return false;           // markdown headers (injected docs)
  if (text.startsWith("[Request interrupted")) return false;
  if (text.startsWith("Implement the following plan:")) return false;
  if (/^resume\b/i.test(text)) return false;
  // Skip system role prompts injected as user messages
  if (/^You are a\b/i.test(text)) return false;
  // Skip long preambles (>500 chars without newlines are usually injected context)
  if (text.length > 500 && !text.includes("\n")) return false;
  return true;
}

/**
 * Extract the real project path by reading the `cwd` field from a session JSONL file.
 * Returns null if no cwd found.
 */
function extractProjectPath(dir: string, jsonlFiles: string[]): string | null {
  // Try the first file's first few lines
  const first = jsonlFiles[0];
  if (!first) return null;

  try {
    const content = readFileSync(join(dir, first), "utf-8");
    // Only read up to the first 5 lines to avoid parsing huge files
    const lines = content.split("\n").slice(0, 5);
    for (const line of lines) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === "string" && obj.cwd.startsWith("/")) {
          return obj.cwd;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
}

/**
 * Extract unique file paths from transcript tool entries.
 */
function extractFilesTouched(transcript: import("./types.js").SessionEntry[]): string[] {
  const files = new Set<string>();
  for (const entry of transcript) {
    if (entry.filesAffected) {
      for (const f of entry.filesAffected) files.add(f);
    }
  }
  return [...files];
}

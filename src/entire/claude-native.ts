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

import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseTranscript } from "./transcript.js";
import type {
  Checkpoint,
  CheckpointInfo,
  CheckpointRoot,
  Session,
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
  return listSessionsFromDir(dir);
}

/**
 * List sessions from a given Claude Code project directory.
 * Shared implementation for both project-root and slug-based lookups.
 */
function listSessionsFromDir(dir: string): CheckpointInfo[] {
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
        filesTouched: meta.filesTouched ?? [],
        agent: "Claude Code",
        sessionCount: 1,
        sessionIds: [file.sessionId],
        title: meta.firstPrompt,
      });
    } catch {
      // Skip unreadable files
    }
  }

  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sessions;
}

/** Max bytes to read when extracting metadata for listing (64KB). */
const META_READ_LIMIT = 64 * 1024;

/**
 * Read the first `maxBytes` of a file and return complete lines.
 * Avoids reading multi-MB session files when we only need metadata.
 */
function readHeadBytes(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    const raw = buf.toString("utf-8", 0, bytesRead);
    // Drop the last partial line (if the file was truncated mid-line)
    const lastNewline = raw.lastIndexOf("\n");
    return lastNewline >= 0 ? raw.slice(0, lastNewline) : raw;
  } finally {
    closeSync(fd);
  }
}

/**
 * Extract basic metadata from a session JSONL.
 *
 * When called with only a path (listing mode), reads only the first 64KB
 * to avoid loading multi-MB files just for titles and dates.
 *
 * When called with content (loading mode), parses the full content —
 * this avoids a redundant re-read since the caller already has the file.
 */
function extractSessionMeta(path: string, fullContent?: string): {
  createdAt: string;
  model?: string;
  version?: string;
  totalTokens?: TokenUsage;
  firstPrompt?: string;
  filesTouched?: string[];
} {
  const content = fullContent ?? readHeadBytes(path, META_READ_LIMIT);
  const lines = content.split("\n").filter(Boolean);

  let createdAt = "";
  let model: string | undefined;
  let version: string | undefined;
  let firstPrompt: string | undefined;
  let pipedFallback: string | undefined;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let apiCalls = 0;
  const filesSet = new Set<string>();

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
        } else if (!pipedFallback) {
          // For piped agent sessions, extract a fallback from the raw content
          const raw = extractRawUserText(obj);
          if (raw && raw.length > 20) {
            pipedFallback = `[piped] ${summarizePipedPrompt(raw)}`;
          }
        }
      }

      // Extract file paths from tool_use blocks in assistant messages
      if (obj.type === "assistant" && obj.message?.content) {
        const blocks = Array.isArray(obj.message.content) ? obj.message.content : [];
        for (const block of blocks) {
          if (block.type === "tool_use" && block.input) {
            const fp = block.input.file_path ?? block.input.filePath ?? block.input.path;
            if (typeof fp === "string" && fp.startsWith("/")) {
              filesSet.add(fp);
            }
          }
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

  const filesTouched = filesSet.size > 0 ? [...filesSet] : undefined;
  return { createdAt, model, version, totalTokens, firstPrompt: firstPrompt || pipedFallback, filesTouched };
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
  return loadSessionFromDir(dir, sessionId);
}

/**
 * Load a session from a given directory.
 * Shared implementation for both project-root and slug-based lookups.
 */
function loadSessionFromDir(dir: string, sessionId: string): Checkpoint | null {
  const path = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8");
  const meta = extractSessionMeta(path, content);
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
  /** Agent sources contributing to this project (set when merged) */
  agents?: Array<{ agent: string; slug: string; sessionCount: number }>;
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
    const name = projectPath.includes("/")
      ? projectPath.split("/").filter(Boolean).pop() || slug
      : slugToName(slug);

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
  return listSessionsFromDir(dir);
}

/**
 * Load a session by slug + sessionId (for global mode where we don't have a project root).
 */
export function loadNativeSessionBySlug(
  slug: string,
  sessionId: string,
): Checkpoint | null {
  const dir = join(homedir(), ".claude", "projects", slug);
  return loadSessionFromDir(dir, sessionId);
}

/**
 * Summarize a piped prompt into a short title.
 * Tries to find the actual task description past role preamble.
 */
function summarizePipedPrompt(raw: string): string {
  // Try to find the actual task past "You are a ..." preamble
  const sentences = raw.split(/(?<=\.)\s+/);
  for (const s of sentences) {
    // Skip role descriptions
    if (/^You are\b/i.test(s)) continue;
    if (/^Your (?:job|task|role)\b/i.test(s)) {
      return s.slice(0, 70);
    }
    // First non-role sentence is probably the task
    if (s.length > 10 && !/^(?:Follow|Note|Important|Remember)\b/i.test(s)) {
      return s.slice(0, 70);
    }
  }
  return raw.slice(0, 60);
}

/**
 * Extract raw text from a user entry without filtering.
 * Used as fallback for piped sessions to generate a descriptive title.
 */
function extractRawUserText(obj: Record<string, unknown>): string | null {
  const msg = obj.message as Record<string, unknown> | undefined;
  const content = msg?.content ?? obj.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = (content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);
    return texts.join(" ") || null;
  }
  return null;
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

  // Content block array — extract text blocks, ignoring tool_results
  if (Array.isArray(content)) {
    const blocks = content as Array<Record<string, unknown>>;

    // If the array contains ONLY tool_result blocks, it's not a user prompt
    const hasToolResult = blocks.some((b) => b.type === "tool_result");

    // Extract text from text blocks
    const textParts = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);

    // If there are only tool_results and no text, skip
    if (hasToolResult && textParts.length === 0) return null;

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
 * Extract a human-readable name from a Claude Code slug.
 * Slugs are paths with / replaced by - (e.g., -Users-lu-code-small-projects-letai).
 * We take the last segment as the name.
 */
function slugToName(slug: string): string {
  // First try to reconstruct the real path and use the last component
  const path = slug2path(slug);
  if (path) {
    return path.split("/").filter(Boolean).pop() || slug;
  }

  // Fallback heuristic: split on - and find the project name.
  // Common pattern: -Users-<user>-code-<...>-<project-name>
  const parts = slug.split("-").filter(Boolean);

  // Known path segments to skip
  const skipWords = new Set(["Users", "home", "code", "projects", "small", "var", "tmp", "opt", "src", "Dropbox"]);

  // Walk backwards to find the first meaningful segment
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!skipWords.has(parts[i]) && parts[i].length > 1) {
      // Include subsequent parts too (project name might be multi-word)
      return parts.slice(i).join("-");
    }
  }

  return parts[parts.length - 1] || slug;
}

/**
 * Extract the real project path by reading the `cwd` field from a session JSONL file.
 * Returns null if no cwd found.
 */
function extractProjectPath(dir: string, jsonlFiles: string[]): string | null {
  // Try up to 3 files' first few lines to find a cwd
  const filesToTry = jsonlFiles.slice(0, 3);

  for (const file of filesToTry) {
    try {
      const content = readHeadBytes(join(dir, file), 4096);
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
  }

  // Fallback: reconstruct path from slug.
  // Slug format is the absolute path with / replaced by -.
  // e.g., -Users-lu-code-foo → /Users/lu/code/foo
  // This is ambiguous when directory names contain hyphens, but we can
  // validate by checking if the reconstructed path exists.
  const reconstructed = slug2path(dir.split("/").pop() || "");
  if (reconstructed && existsSync(reconstructed)) {
    return reconstructed;
  }

  return null;
}

/**
 * Attempt to reconstruct an absolute path from a Claude Code slug.
 * Tries the simple case (replace leading - with / and remaining - with /)
 * then validates the result exists on disk.
 */
function slug2path(slug: string): string | null {
  if (!slug.startsWith("-")) return null;
  // Simple reconstruction: replace all - with /
  const candidate = slug.replace(/-/g, "/");
  if (existsSync(candidate)) return candidate;

  // Try splitting at common prefixes and reconstructing
  // e.g., -Users-lu-code-my-project → /Users/lu/code/my-project
  const parts = slug.slice(1).split("-"); // remove leading -
  // Try progressively joining later segments with hyphens
  for (let splitAt = parts.length - 1; splitAt >= 3; splitAt--) {
    const prefix = "/" + parts.slice(0, splitAt).join("/");
    const suffix = parts.slice(splitAt).join("-");
    const path = suffix ? prefix + "/" + suffix : prefix;
    if (existsSync(path)) return path;
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

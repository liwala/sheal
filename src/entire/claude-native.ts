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
} {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let createdAt = "";
  let model: string | undefined;
  let version: string | undefined;
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

  return { createdAt, model, version, totalTokens };
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

/**
 * Amp session reader.
 *
 * Reads file-change threads from ~/.amp/file-changes/T-{threadId}/
 *
 * Each file in a thread directory is a JSON object with:
 *   { id, uri, before, after, diff, isNewFile, reverted, timestamp }
 *
 * Threads are grouped by project path (inferred from file URI common prefix).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { NativeProject } from "./claude-native.js";
import type { CheckpointInfo } from "./types.js";

const AMP_DIR = join(homedir(), ".amp", "file-changes");

export interface AmpFileChange {
  id: string;
  filePath: string;
  diff: string;
  isNewFile: boolean;
  reverted: boolean;
  timestamp: number;
}

export interface AmpThread {
  threadId: string;
  projectPath: string;
  name: string;
  fileCount: number;
  timestamp: number;
  revertedCount: number;
}

/**
 * Check if Amp file-change sessions exist.
 */
export function hasAmpSessions(): boolean {
  return existsSync(AMP_DIR);
}

/**
 * Parse a single file-change JSON, extracting only the fields we need
 * (avoiding loading full before/after content into memory).
 */
function parseFileChangeMeta(filePath: string): {
  id: string;
  uri: string;
  isNewFile: boolean;
  reverted: boolean;
  timestamp: number;
  diff: string;
} | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const obj = JSON.parse(raw);
    return {
      id: obj.id || "",
      uri: obj.uri || "",
      isNewFile: !!obj.isNewFile,
      reverted: !!obj.reverted,
      timestamp: obj.timestamp || 0,
      diff: obj.diff || "",
    };
  } catch {
    return null;
  }
}

/**
 * Strip file:// prefix and return the filesystem path from a URI.
 */
function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return uri.slice(7);
  }
  return uri;
}

/**
 * Find the common directory prefix across a set of file paths.
 */
function commonDirPrefix(paths: string[]): string {
  if (paths.length === 0) return "/";
  if (paths.length === 1) {
    // Return the directory of the single file
    const parts = paths[0].split("/");
    parts.pop();
    return parts.join("/") || "/";
  }

  const segments = paths.map((p) => p.split("/"));
  const common: string[] = [];
  const minLen = Math.min(...segments.map((s) => s.length));

  for (let i = 0; i < minLen; i++) {
    const seg = segments[0][i];
    if (segments.every((s) => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }

  // Remove trailing filename segment — we want the directory
  // If the common prefix IS a full path to a file, go up one level
  const result = common.join("/") || "/";
  // Check if the last common segment is a directory by seeing if
  // any path extends beyond it (i.e., common is a proper prefix)
  if (common.length < minLen) {
    return result;
  }
  // Common matches full length of shortest path — go up one
  const parts = result.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

/**
 * Read all thread directories and collect thread metadata.
 */
function collectThreads(): AmpThread[] {
  if (!existsSync(AMP_DIR)) return [];

  const threads: AmpThread[] = [];

  try {
    for (const entry of readdirSync(AMP_DIR)) {
      const threadDir = join(AMP_DIR, entry);
      try {
        if (!statSync(threadDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const files = readdirSync(threadDir).filter((f) => !f.startsWith("."));
      if (files.length === 0) continue;

      const filePaths: string[] = [];
      let earliestTimestamp = Infinity;
      let revertedCount = 0;

      for (const f of files) {
        const meta = parseFileChangeMeta(join(threadDir, f));
        if (!meta) continue;

        filePaths.push(uriToPath(meta.uri));
        if (meta.timestamp < earliestTimestamp) {
          earliestTimestamp = meta.timestamp;
        }
        if (meta.reverted) revertedCount++;
      }

      if (filePaths.length === 0) continue;

      const projectPath = commonDirPrefix(filePaths);
      const name = projectPath.split("/").filter(Boolean).pop() || entry;

      threads.push({
        threadId: entry,
        projectPath,
        name,
        fileCount: filePaths.length,
        timestamp: earliestTimestamp === Infinity ? 0 : earliestTimestamp,
        revertedCount,
      });
    }
  } catch {
    // skip errors in traversal
  }

  // Sort by timestamp descending (most recent first)
  threads.sort((a, b) => b.timestamp - a.timestamp);
  return threads;
}

/**
 * List all Amp projects, grouped by project path.
 * Returns NativeProject[] compatible objects.
 */
export function listAmpProjects(): NativeProject[] {
  if (!hasAmpSessions()) return [];

  const threads = collectThreads();

  // Group threads by project path
  const byProject = new Map<string, AmpThread[]>();
  for (const t of threads) {
    const key = t.projectPath;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(t);
  }

  const projects: NativeProject[] = [];
  for (const [projectPath, projectThreads] of byProject) {
    const name = projectPath.split("/").filter(Boolean).pop() || projectPath;
    const latest = projectThreads[0]; // already sorted by timestamp desc
    const totalFiles = projectThreads.reduce((sum, t) => sum + t.fileCount, 0);

    projects.push({
      slug: `amp:${projectPath}`,
      projectPath,
      name,
      sessionCount: projectThreads.length,
      lastModified: new Date(latest.timestamp).toISOString(),
    });
  }

  projects.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return projects;
}

/**
 * List Amp sessions (threads) for a given project path.
 * Returns CheckpointInfo[] matching the standard session listing interface.
 */
export function listAmpSessionsForProject(projectPath: string): CheckpointInfo[] {
  const threads = collectThreads().filter((t) => t.projectPath === projectPath);

  return threads.map((t) => {
    // Build a descriptive title
    let title: string;
    if (t.fileCount === 1) {
      // Try to get the first filename
      const files = listAmpThreadFiles(t.threadId);
      title = files[0]?.filePath.split("/").pop() || `1 file`;
    } else {
      title = `Modified ${t.fileCount} files`;
      if (t.revertedCount > 0) {
        title += ` (${t.revertedCount} reverted)`;
      }
    }

    // Get file paths relative to project
    const files = listAmpThreadFiles(t.threadId);
    const filesTouched = files.map((f) => {
      if (f.filePath.startsWith(projectPath)) {
        return f.filePath.slice(projectPath.length + 1);
      }
      return f.filePath;
    });

    return {
      checkpointId: t.threadId,
      sessionId: t.threadId,
      createdAt: new Date(t.timestamp).toISOString(),
      filesTouched,
      agent: "Amp" as const,
      sessionCount: 1,
      sessionIds: [t.threadId],
      title,
    };
  });
}

/**
 * Get the inferred project path for an Amp thread.
 */
export function getAmpThreadProjectPath(threadId: string): string | null {
  const threads = collectThreads();
  const thread = threads.find((t) => t.threadId === threadId);
  return thread?.projectPath ?? null;
}

/**
 * List all file changes for a specific Amp thread.
 */
export function listAmpThreadFiles(threadId: string): AmpFileChange[] {
  const threadDir = join(AMP_DIR, threadId);
  if (!existsSync(threadDir)) return [];

  const changes: AmpFileChange[] = [];

  try {
    for (const f of readdirSync(threadDir)) {
      if (f.startsWith(".")) continue;
      const meta = parseFileChangeMeta(join(threadDir, f));
      if (!meta) continue;

      changes.push({
        id: meta.id,
        filePath: uriToPath(meta.uri),
        diff: meta.diff,
        isNewFile: meta.isNewFile,
        reverted: meta.reverted,
        timestamp: meta.timestamp,
      });
    }
  } catch {
    // skip errors
  }

  // Sort by timestamp ascending
  changes.sort((a, b) => a.timestamp - b.timestamp);
  return changes;
}

/**
 * Gather sessions from every agent source for one or more projects.
 *
 * Provides a single entry point for commands that need multi-agent session
 * data (e.g., `sheal agents`, and a future refactor target for Timeline and
 * SessionList).
 */
import { listAllNativeProjects, listNativeSessionsBySlug } from "../entire/claude-native.js";
import { listCodexProjects, listCodexSessionsForProject } from "../entire/codex-native.js";
import { listAmpProjects, listAmpSessionsForProject } from "../entire/amp-native.js";
import { listGeminiProjects, listGeminiSessionsForProject } from "../entire/gemini-native.js";
import type { CheckpointInfo } from "../entire/types.js";

export interface ProjectSummary {
  projectPath: string;
  name: string;
}

/**
 * Discover every project that has sessions from any agent, keyed by projectPath.
 * Only projects with an absolute projectPath are returned (drops slug-only
 * entries that don't map to a real directory).
 */
export function listAllProjects(): ProjectSummary[] {
  const byPath = new Map<string, ProjectSummary>();

  for (const p of listAllNativeProjects()) {
    if (!p.projectPath.startsWith("/")) continue;
    if (!byPath.has(p.projectPath)) byPath.set(p.projectPath, { projectPath: p.projectPath, name: p.name });
  }
  for (const p of listCodexProjects()) {
    if (!byPath.has(p.projectPath)) byPath.set(p.projectPath, { projectPath: p.projectPath, name: p.name });
  }
  for (const p of listAmpProjects()) {
    if (!byPath.has(p.projectPath)) byPath.set(p.projectPath, { projectPath: p.projectPath, name: p.name });
  }
  for (const p of listGeminiProjects()) {
    if (!byPath.has(p.projectPath)) byPath.set(p.projectPath, { projectPath: p.projectPath, name: p.name });
  }

  return [...byPath.values()];
}

/**
 * Gather sessions for a single project from every agent source. Piped
 * sessions and Entire.io checkpoints are excluded by default to match the
 * Timeline view's defaults.
 */
export function gatherSessionsForProject(projectPath: string): CheckpointInfo[] {
  const sessions: CheckpointInfo[] = [];
  // Claude sessions live under a slug derived from the absolute path.
  const claudeSlug = projectPath.replace(/\//g, "-");
  sessions.push(...listNativeSessionsBySlug(claudeSlug));
  sessions.push(...listCodexSessionsForProject(projectPath));
  sessions.push(...listAmpSessionsForProject(projectPath));
  sessions.push(...listGeminiSessionsForProject(projectPath));
  return sessions.filter((s) => !s.title?.startsWith("[piped]"));
}

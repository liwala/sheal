/**
 * Session loader with time-window filtering.
 *
 * Scans all Claude Code, Codex, and Amp projects,
 * filters sessions by date range, and extracts user prompts with token usage.
 */

import {
  listAllNativeProjects,
  listNativeSessionsBySlug,
  loadNativeSessionBySlug,
} from "../entire/claude-native.js";
import { listCodexProjects, listCodexSessionsForProject, loadCodexSession } from "../entire/codex-native.js";
import { listAmpProjects } from "../entire/amp-native.js";
import type { NativeProject } from "../entire/claude-native.js";
import type { TokenUsage } from "../entire/types.js";
import type { RawPrompt, TokenSummary } from "./types.js";

export interface LoadResult {
  prompts: RawPrompt[];
  tokens: TokenSummary;
  sessionCount: number;
}

/**
 * Parse a --since value into a Date.
 * Supports: "7 days", "1 week", "2 weeks", "1 month", "30 days", or ISO date strings.
 */
export function parseSince(since: string): Date {
  const now = new Date();

  // Try relative format: "N day(s)|week(s)|month(s)"
  const match = since.match(/^(\d+)\s*(day|week|month)s?$/i);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === "day") {
      now.setDate(now.getDate() - n);
    } else if (unit === "week") {
      now.setDate(now.getDate() - n * 7);
    } else if (unit === "month") {
      now.setMonth(now.getMonth() - n);
    }
    return now;
  }

  // Try ISO date
  const parsed = new Date(since);
  if (!isNaN(parsed.getTime())) return parsed;

  // Default to 7 days ago
  now.setDate(now.getDate() - 7);
  return now;
}

/**
 * Load all sessions within a time window, across all agents and projects.
 */
export function loadSessionsInWindow(opts: {
  since: Date;
  until?: Date;
  projectFilter?: string;
}): LoadResult {
  const { since, projectFilter } = opts;
  const until = opts.until || new Date();
  const sinceISO = since.toISOString();
  const untilISO = until.toISOString();

  const prompts: RawPrompt[] = [];
  const tokens: TokenSummary = {
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheCreate: 0,
    totalApiCalls: 0,
    byAgent: {},
    byProject: {},
  };
  let sessionCount = 0;

  // --- Claude Code sessions ---
  const claudeProjects = listAllNativeProjects();
  const filteredClaude = projectFilter
    ? claudeProjects.filter((p) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
    : claudeProjects;

  for (const project of filteredClaude) {
    const sessions = listNativeSessionsBySlug(project.slug);

    for (const info of sessions) {
      if (info.createdAt < sinceISO || info.createdAt > untilISO) continue;

      const cp = loadNativeSessionBySlug(project.slug, info.sessionId);
      if (!cp || cp.sessions.length === 0) continue;

      sessionCount++;

      for (const session of cp.sessions) {
        // Extract token usage
        const tu = session.metadata.tokenUsage;
        if (tu) {
          addTokens(tokens, tu, "claude", project.name);
        }

        // Extract user prompts
        for (const prompt of session.prompts) {
          if (prompt && prompt.length > 5) {
            prompts.push({
              text: prompt,
              sessionId: info.sessionId,
              project: project.name,
              agent: "claude",
              timestamp: info.createdAt,
            });
          }
        }
      }
    }
  }

  // --- Codex sessions ---
  try {
    const codexProjects = listCodexProjects();
    const filteredCodex = projectFilter
      ? codexProjects.filter((p) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
      : codexProjects;

    for (const project of filteredCodex) {
      const sessions = listCodexSessionsForProject(project.projectPath);

      for (const info of sessions) {
        if (info.createdAt < sinceISO || info.createdAt > untilISO) continue;

        const result = loadCodexSession(info.sessionId);
        if (!result || result.entries.length === 0) continue;

        sessionCount++;

        // Extract user prompts from Codex
        for (const entry of result.entries) {
          if (entry.role === "user" && entry.content && entry.content.length > 5) {
            prompts.push({
              text: entry.content,
              sessionId: info.sessionId,
              project: project.name,
              agent: "codex",
              timestamp: info.createdAt,
            });
          }
        }
      }
    }
  } catch {
    // Codex not available, skip
  }

  // --- Amp sessions ---
  // Amp only has file-change diffs, no user prompts — skip for digest.
  // But count them for token summary awareness.
  try {
    const ampProjects = listAmpProjects();
    const filteredAmp = projectFilter
      ? ampProjects.filter((p: NativeProject) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
      : ampProjects;

    for (const project of filteredAmp) {
      if (project.lastModified >= sinceISO && project.lastModified <= untilISO) {
        // Amp doesn't provide token data or prompts, just note it exists
        if (!tokens.byAgent["amp"]) {
          tokens.byAgent["amp"] = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, apiCalls: 0, sessionCount: 0 };
        }
        tokens.byAgent["amp"].sessionCount += project.sessionCount;
      }
    }
  } catch {
    // Amp not available, skip
  }

  return { prompts, tokens, sessionCount };
}

function addTokens(
  summary: TokenSummary,
  tu: TokenUsage,
  agent: string,
  project: string,
): void {
  summary.totalInput += tu.inputTokens;
  summary.totalOutput += tu.outputTokens;
  summary.totalCacheRead += tu.cacheReadTokens;
  summary.totalCacheCreate += tu.cacheCreationTokens;
  summary.totalApiCalls += tu.apiCallCount;

  if (!summary.byAgent[agent]) {
    summary.byAgent[agent] = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, apiCalls: 0, sessionCount: 0 };
  }
  summary.byAgent[agent].input += tu.inputTokens;
  summary.byAgent[agent].output += tu.outputTokens;
  summary.byAgent[agent].cacheRead += tu.cacheReadTokens;
  summary.byAgent[agent].cacheCreate += tu.cacheCreationTokens;
  summary.byAgent[agent].apiCalls += tu.apiCallCount;
  summary.byAgent[agent].sessionCount++;

  if (!summary.byProject[project]) {
    summary.byProject[project] = { input: 0, output: 0, sessionCount: 0 };
  }
  summary.byProject[project].input += tu.inputTokens;
  summary.byProject[project].output += tu.outputTokens;
  summary.byProject[project].sessionCount++;
}

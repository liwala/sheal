/**
 * Session loader with time-window filtering.
 *
 * Scans all Claude Code, Codex, and Amp projects,
 * filters sessions by date range, and extracts user prompts with token usage.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  listAllNativeProjects,
  listNativeSessionsBySlug,
  loadNativeSessionBySlug,
} from "../entire/claude-native.js";
import { listCodexProjects, listCodexSessionsForProject, loadCodexSession } from "../entire/codex-native.js";
import { listAmpProjects } from "../entire/amp-native.js";
import type { NativeProject } from "../entire/claude-native.js";
import type { TokenUsage } from "../entire/types.js";
import type { RawPrompt, TokenSummary, AgentScanStatus } from "./types.js";

export interface LoadResult {
  prompts: RawPrompt[];
  tokens: TokenSummary;
  sessionCount: number;
  agentScans: AgentScanStatus[];
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
    byModel: {},
    byProjectModel: {},
  };
  let sessionCount = 0;
  const agentScans: AgentScanStatus[] = [];

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

      // Extract per-model tokens from raw JSONL
      const jsonlPath = join(homedir(), ".claude", "projects", project.slug, `${info.sessionId}.jsonl`);
      extractModelTokens(jsonlPath, tokens, project.name);

      for (const session of cp.sessions) {
        // Extract aggregated token usage
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

  agentScans.push({
    agent: "claude",
    available: true,
    projectCount: filteredClaude.length,
    sessionCount: tokens.byAgent["claude"]?.sessionCount || 0,
  });

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
    agentScans.push({
      agent: "codex",
      available: true,
      projectCount: filteredCodex.length,
      sessionCount: tokens.byAgent["codex"]?.sessionCount || 0,
    });
  } catch (e) {
    agentScans.push({
      agent: "codex",
      available: false,
      projectCount: 0,
      sessionCount: 0,
      error: e instanceof Error ? e.message : "Not available",
    });
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
    agentScans.push({
      agent: "amp",
      available: true,
      projectCount: filteredAmp.length,
      sessionCount: tokens.byAgent["amp"]?.sessionCount || 0,
    });
  } catch (e) {
    agentScans.push({
      agent: "amp",
      available: false,
      projectCount: 0,
      sessionCount: 0,
      error: e instanceof Error ? e.message : "Not available",
    });
  }

  return { prompts, tokens, sessionCount, agentScans };
}

/**
 * Extract per-model token usage from raw JSONL.
 * Reads assistant messages with model + usage fields.
 */
function extractModelTokens(jsonlPath: string, summary: TokenSummary, projectName?: string): void {
  if (!existsSync(jsonlPath)) return;

  try {
    const content = readFileSync(jsonlPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant" && obj.message?.model && obj.message?.usage) {
          let model = obj.message.model as string;
          if (model === "<synthetic>") continue;

          // Detect fast mode (6x pricing multiplier)
          const u = obj.message.usage;
          if (u.speed === "fast") model = `${model}-fast`;

          const input = u.input_tokens ?? 0;
          const output = u.output_tokens ?? 0;
          const cacheRead = u.cache_read_input_tokens ?? 0;
          const cacheCreate = u.cache_creation_input_tokens ?? 0;

          if (!summary.byModel[model]) {
            summary.byModel[model] = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, apiCalls: 0 };
          }
          summary.byModel[model].input += input;
          summary.byModel[model].output += output;
          summary.byModel[model].cacheRead += cacheRead;
          summary.byModel[model].cacheCreate += cacheCreate;
          summary.byModel[model].apiCalls++;

          // Track per-project-per-model
          if (projectName) {
            if (!summary.byProjectModel[projectName]) {
              summary.byProjectModel[projectName] = {};
            }
            if (!summary.byProjectModel[projectName][model]) {
              summary.byProjectModel[projectName][model] = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, apiCalls: 0 };
            }
            summary.byProjectModel[projectName][model].input += input;
            summary.byProjectModel[projectName][model].output += output;
            summary.byProjectModel[projectName][model].cacheRead += cacheRead;
            summary.byProjectModel[projectName][model].cacheCreate += cacheCreate;
            summary.byProjectModel[projectName][model].apiCalls++;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // skip unreadable files
  }
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

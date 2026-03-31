/**
 * `sheal digest` — Generate a categorized digest of user prompts across sessions.
 *
 * Scans all agents (Claude, Codex, Amp), filters by time window,
 * categorizes prompts, tracks token usage, and saves the report.
 */

import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadSessionsInWindow, parseSince } from "../digest/loader.js";
import { categorizePrompts } from "../digest/categorize.js";
import { formatPretty, formatJSON, formatMarkdown } from "../digest/formatter.js";
import type { DigestReport } from "../digest/types.js";

export interface DigestOptions {
  since: string;
  until?: string;
  project?: string;
  format: string;
  output?: string;
  topN: number;
}

export async function runDigest(options: DigestOptions): Promise<void> {
  const sinceDate = parseSince(options.since);
  const untilDate = options.until ? new Date(options.until) : new Date();

  const log = options.format === "json" ? console.error : console.log;

  log(chalk.gray(`Loading sessions since ${sinceDate.toISOString().slice(0, 10)}...`));

  const { prompts, tokens, sessionCount } = loadSessionsInWindow({
    since: sinceDate,
    until: untilDate,
    projectFilter: options.project,
  });

  if (sessionCount === 0) {
    log(chalk.yellow("No sessions found in the specified time window."));
    return;
  }

  log(chalk.gray(`Found ${sessionCount} sessions, ${prompts.length} prompts. Categorizing...`));

  const { categories, uncategorized } = categorizePrompts(prompts);

  const report: DigestReport = {
    generatedAt: new Date().toISOString(),
    window: {
      since: sinceDate.toISOString(),
      until: untilDate.toISOString(),
    },
    scope: options.project ? "project" : "global",
    projectFilter: options.project,
    totalSessions: sessionCount,
    totalPrompts: prompts.length,
    categories,
    uncategorized,
    tokens,
  };

  // Format output
  let output: string;
  switch (options.format) {
    case "json":
      output = formatJSON(report);
      break;
    case "markdown":
    case "md":
      output = formatMarkdown(report);
      break;
    default:
      output = formatPretty(report);
  }

  console.log(output);

  // Save to file
  if (options.output) {
    writeFileSync(options.output, output, "utf-8");
    log(chalk.gray(`\nSaved to ${options.output}`));
  }

  // Always save JSON report to ~/.sheal/digests/
  const saveDir = join(homedir(), ".sheal", "digests");
  const savedPath = saveDigestReport(saveDir, report);
  log(chalk.gray(`Report saved: ${savedPath}`));
}

function saveDigestReport(dir: string, report: DigestReport): string {
  mkdirSync(dir, { recursive: true });

  const date = report.generatedAt.slice(0, 10);
  const scope = report.projectFilter || "global";
  const filename = `${date}-${scope}.json`;
  const path = join(dir, filename);

  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}

/**
 * List saved digest reports (for browse TUI).
 */
export interface DigestInfo {
  filename: string;
  date: string;
  scope: string;
  totalSessions: number;
  totalPrompts: number;
  tokenTotal: number;
  categoryBreakdown: string;
}

export function listDigests(dir?: string): DigestInfo[] {
  const digestDir = dir || join(homedir(), ".sheal", "digests");
  if (!existsSync(digestDir)) return [];

  const files = readdirSync(digestDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const digests: DigestInfo[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(digestDir, file), "utf-8");
      const report: DigestReport = JSON.parse(content);

      const catCounts = Object.entries(report.categories)
        .map(([cat, items]) => `${cat.slice(0, 3)}:${items.length}`)
        .join(" ");

      digests.push({
        filename: file,
        date: report.generatedAt.slice(0, 10),
        scope: report.projectFilter || "global",
        totalSessions: report.totalSessions,
        totalPrompts: report.totalPrompts,
        tokenTotal: report.tokens.totalInput + report.tokens.totalOutput,
        categoryBreakdown: catCounts,
      });
    } catch {
      // skip malformed files
    }
  }

  return digests;
}

/**
 * Load a single digest report by filename.
 */
export function loadDigest(filename: string, dir?: string): DigestReport | null {
  const digestDir = dir || join(homedir(), ".sheal", "digests");
  const path = join(digestDir, filename);

  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

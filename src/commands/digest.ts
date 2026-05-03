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
import { categorizePrompts, enrichWithLLM } from "../digest/categorize.js";
import { formatPretty, formatJSON, formatMarkdown, formatDiffPretty } from "../digest/formatter.js";
import { estimateCost, diffDigests } from "../digest/cost.js";
import type { DigestReport } from "../digest/types.js";

export interface DigestOptions {
  since: string;
  until?: string;
  project?: string;
  format: string;
  output?: string;
  topN: number;
  compare?: boolean;
  enrich?: boolean;
}

export interface BuildDigestOptions {
  since: string;
  until?: string;
  project?: string;
  enrich?: boolean;
  /** Where to write progress output (default: console.error). */
  log?: (msg: string) => void;
}

/**
 * Load sessions in a time window, categorize prompts, and assemble a DigestReport.
 * Returns null when no sessions are found (caller decides what to print).
 */
export async function buildDigestReport(opts: BuildDigestOptions): Promise<DigestReport | null> {
  const log = opts.log ?? ((s: string) => console.error(s));
  const sinceDate = parseSince(opts.since);
  const untilDate = opts.until ? new Date(opts.until) : new Date();

  log(chalk.gray(`Loading sessions since ${sinceDate.toISOString().slice(0, 10)}...`));

  const { prompts, tokens, sessionCount, agentScans } = loadSessionsInWindow({
    since: sinceDate,
    until: untilDate,
    projectFilter: opts.project,
  });

  if (sessionCount === 0) {
    log(chalk.yellow("No sessions found in the specified time window."));
    for (const scan of agentScans) {
      if (!scan.available) {
        log(chalk.gray(`  ${scan.agent}: ${scan.error || "not available"}`));
      }
    }
    return null;
  }

  log(chalk.gray(`Found ${sessionCount} sessions, ${prompts.length} prompts. Categorizing...`));

  for (const scan of agentScans) {
    if (!scan.available) {
      log(chalk.gray(`  Skipped ${scan.agent}: ${scan.error || "not available"}`));
    }
  }

  let { categories, uncategorized } = categorizePrompts(prompts);

  if (opts.enrich) {
    log(chalk.gray("Enriching categorization with Haiku..."));
    const enriched = await enrichWithLLM({ categories, uncategorized });
    categories = enriched.categories;
    uncategorized = enriched.uncategorized;
    log(chalk.gray("Done."));
  }

  const cost = estimateCost(tokens);

  return {
    generatedAt: new Date().toISOString(),
    window: { since: sinceDate.toISOString(), until: untilDate.toISOString() },
    scope: opts.project ? "project" : "global",
    projectFilter: opts.project,
    totalSessions: sessionCount,
    totalPrompts: prompts.length,
    categories,
    uncategorized,
    tokens,
    agentScans,
    cost,
  };
}

export async function runDigest(options: DigestOptions): Promise<void> {
  const log = options.format === "json" ? console.error : console.log;

  const report = await buildDigestReport({
    since: options.since,
    until: options.until,
    project: options.project,
    enrich: options.enrich,
    log,
  });

  if (!report) return;

  let output: string;

  // If --compare, find previous digest and show diff
  if (options.compare) {
    const previous = findPreviousDigest(report);
    if (previous) {
      const diff = diffDigests(report, previous);
      output = formatDiffPretty(diff);
    } else {
      log(chalk.yellow("No previous digest found to compare against. Showing full report."));
      output = formatPretty(report);
    }
  } else {
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

/**
 * Persist a digest report as JSON. Used by `runDigest` and `runWeekly` so
 * weekly runs are visible to `sheal browse digests`.
 */
export function saveDigestReport(dir: string, report: DigestReport): string {
  mkdirSync(dir, { recursive: true });

  // Include time in filename to avoid overwriting same-day digests.
  // This allows --compare to find a previous digest from earlier the same day.
  const timestamp = report.generatedAt.replace(/:/g, "-").slice(0, 19);
  const scope = report.projectFilter || "global";
  const filename = `${timestamp}-${scope}.json`;
  const path = join(dir, filename);

  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}

/**
 * Find the most recent previous digest matching the same scope.
 */
function findPreviousDigest(current: DigestReport): DigestReport | null {
  const digests = listDigests();
  const currentTimestamp = current.generatedAt;
  const scope = current.projectFilter || "global";

  for (const info of digests) {
    // Must match scope
    if (info.scope !== scope) continue;
    // Skip the current one (same timestamp)
    if (info.generatedAt === currentTimestamp) continue;

    const report = loadDigest(info.filename);
    if (report) return report;
  }
  return null;
}

/**
 * List saved digest reports (for browse TUI).
 */
export interface DigestInfo {
  filename: string;
  date: string;
  generatedAt: string;
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
        generatedAt: report.generatedAt,
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
    const parsed = JSON.parse(content);
    // Validate required shape to avoid runtime crashes on corrupt/hand-edited files
    if (!parsed || !parsed.generatedAt || !parsed.tokens || !parsed.categories) return null;
    return parsed as DigestReport;
  } catch {
    return null;
  }
}

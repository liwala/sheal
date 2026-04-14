/**
 * Output formatters for digest reports.
 *
 * Supports: pretty (terminal), json, markdown.
 */

import chalk from "chalk";
import type { DigestReport, DigestCategory, DigestItem, TokenSummary, DigestDiff } from "./types.js";

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function bar(count: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((count / max) * width) : 0;
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

const CATEGORY_COLORS: Record<DigestCategory, string> = {
  SKILLS: "yellow",
  AGENTS: "magenta",
  SCHEDULED_TASKS: "cyan",
  CLAUDE_MD: "green",
};

const CATEGORY_LABELS: Record<DigestCategory, string> = {
  SKILLS: "SKILLS — Repeatable creative tasks",
  AGENTS: "AGENTS — Autonomous research/action workflows",
  SCHEDULED_TASKS: "SCHEDULED — Recurring things to automate",
  CLAUDE_MD: "CLAUDE.MD — Preferences & context to bake in",
};

export function formatPretty(report: DigestReport): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold.white("Session Digest Report"));
  lines.push(chalk.gray(`${report.window.since.slice(0, 10)} → ${report.window.until.slice(0, 10)}`));
  lines.push(chalk.gray(`${report.totalSessions} sessions | ${report.totalPrompts} prompts | ${report.scope} scope`));
  lines.push("");

  // Token summary
  lines.push(chalk.bold("Token Usage"));
  const t = report.tokens;
  lines.push(`  Input: ${chalk.yellow(formatTokenCount(t.totalInput))}  Output: ${chalk.green(formatTokenCount(t.totalOutput))}  Cache Read: ${chalk.blue(formatTokenCount(t.totalCacheRead))}  API Calls: ${chalk.white(String(t.totalApiCalls))}`);

  // Per-agent breakdown
  const agentEntries = Object.entries(t.byAgent);
  if (agentEntries.length > 0) {
    lines.push("");
    lines.push(chalk.bold("  By Agent"));
    for (const [agent, data] of agentEntries) {
      lines.push(`    ${chalk.bold(agent)}: ${formatTokenCount(data.input + data.output)} tokens, ${data.sessionCount} sessions, ${data.apiCalls} API calls`);
    }
  }

  // Per-project top 5
  const projectEntries = Object.entries(t.byProject)
    .sort(([, a], [, b]) => (b.input + b.output) - (a.input + a.output))
    .slice(0, 5);
  if (projectEntries.length > 0) {
    lines.push("");
    lines.push(chalk.bold("  Top Projects by Tokens"));
    for (const [project, data] of projectEntries) {
      lines.push(`    ${project}: ${formatTokenCount(data.input + data.output)} (${data.sessionCount}s)`);
    }
  }

  // Cost estimate
  if (report.cost) {
    lines.push("");
    lines.push(chalk.bold("  Estimated Cost"));
    lines.push(`    Total: ${chalk.yellowBright(`$${report.cost.totalCost.toFixed(2)}`)}`);
    const projCosts = Object.entries(report.cost.byProject)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    for (const [project, cost] of projCosts) {
      lines.push(`    ${project}: ${chalk.yellow(`$${cost.toFixed(2)}`)}`);
    }
  }

  // Agent scan status (#10)
  if (report.agentScans && report.agentScans.length > 0) {
    const unavailable = report.agentScans.filter((s) => !s.available);
    const available = report.agentScans.filter((s) => s.available);
    lines.push("");
    lines.push(chalk.bold("  Agents Scanned"));
    for (const scan of available) {
      lines.push(`    ${chalk.green("●")} ${scan.agent} (${scan.projectCount}p, ${scan.sessionCount}s)`);
    }
    for (const scan of unavailable) {
      lines.push(`    ${chalk.red("●")} ${scan.agent}: ${chalk.gray(scan.error || "skipped")}`);
    }
  }

  lines.push("");
  lines.push(chalk.gray("─".repeat(60)));

  // Categories
  const allCats: DigestCategory[] = ["SKILLS", "AGENTS", "SCHEDULED_TASKS", "CLAUDE_MD"];
  const maxCount = Math.max(
    ...allCats.flatMap((c) => report.categories[c].map((i) => i.count)),
    ...report.uncategorized.map((i) => i.count),
    1,
  );

  for (const cat of allCats) {
    const items = report.categories[cat];
    lines.push("");
    const color = CATEGORY_COLORS[cat];
    lines.push((chalk as any)[color].bold(`${CATEGORY_LABELS[cat]} (${items.length})`));

    if (items.length === 0) {
      lines.push(chalk.gray("  (none)"));
      continue;
    }

    for (const item of items.slice(0, 10)) {
      const agents = item.agents.join(",");
      lines.push(
        `  ${chalk.white(bar(item.count, maxCount, 15))} ${chalk.bold(String(item.count).padStart(3))}x  ${item.description.slice(0, 60)}`,
      );
      lines.push(
        chalk.gray(`       ${item.projects.join(", ")} [${agents}] ${item.sessionIds[0]?.slice(0, 8) || ""}`),
      );
    }
    if (items.length > 10) {
      lines.push(chalk.gray(`  ... and ${items.length - 10} more`));
    }
  }

  // Uncategorized
  if (report.uncategorized.length > 0) {
    lines.push("");
    lines.push(chalk.gray.bold(`UNCATEGORIZED (${report.uncategorized.length})`));
    for (const item of report.uncategorized.slice(0, 5)) {
      lines.push(`  ${String(item.count).padStart(3)}x  ${item.description.slice(0, 70)}`);
    }
    if (report.uncategorized.length > 5) {
      lines.push(chalk.gray(`  ... and ${report.uncategorized.length - 5} more`));
    }
  }

  lines.push("");
  lines.push(chalk.gray("Reply with session ID to see full context"));

  return lines.join("\n");
}

export function formatJSON(report: DigestReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatMarkdown(report: DigestReport): string {
  const lines: string[] = [];

  lines.push("# Session Digest Report");
  lines.push("");
  lines.push(`**Window:** ${report.window.since.slice(0, 10)} → ${report.window.until.slice(0, 10)}`);
  lines.push(`**Sessions:** ${report.totalSessions} | **Prompts:** ${report.totalPrompts} | **Scope:** ${report.scope}`);
  lines.push("");

  // Token summary
  lines.push("## Token Usage");
  lines.push("");
  const t = report.tokens;
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Input | ${formatTokenCount(t.totalInput)} |`);
  lines.push(`| Output | ${formatTokenCount(t.totalOutput)} |`);
  lines.push(`| Cache Read | ${formatTokenCount(t.totalCacheRead)} |`);
  lines.push(`| Cache Create | ${formatTokenCount(t.totalCacheCreate)} |`);
  lines.push(`| API Calls | ${t.totalApiCalls} |`);
  lines.push("");

  // Agent breakdown
  const agentEntries = Object.entries(t.byAgent);
  if (agentEntries.length > 0) {
    lines.push("### By Agent");
    lines.push("");
    lines.push("| Agent | Tokens | Sessions | API Calls |");
    lines.push("|-------|--------|----------|-----------|");
    for (const [agent, data] of agentEntries) {
      lines.push(`| ${agent} | ${formatTokenCount(data.input + data.output)} | ${data.sessionCount} | ${data.apiCalls} |`);
    }
    lines.push("");
  }

  // Categories
  const allCats: DigestCategory[] = ["SKILLS", "AGENTS", "SCHEDULED_TASKS", "CLAUDE_MD"];

  for (const cat of allCats) {
    const items = report.categories[cat];
    lines.push(`## ${CATEGORY_LABELS[cat]} (${items.length})`);
    lines.push("");

    if (items.length === 0) {
      lines.push("*(none)*");
      lines.push("");
      continue;
    }

    lines.push("| # | Description | Agents | Projects | Sessions |");
    lines.push("|---|-------------|--------|----------|----------|");
    for (const item of items.slice(0, 15)) {
      lines.push(`| ${item.count}x | ${item.description.slice(0, 60)} | ${item.agents.join(",")} | ${item.projects.join(",")} | ${item.sessionIds[0]?.slice(0, 8) || ""} |`);
    }
    lines.push("");
  }

  if (report.uncategorized.length > 0) {
    lines.push(`## Uncategorized (${report.uncategorized.length})`);
    lines.push("");
    for (const item of report.uncategorized.slice(0, 10)) {
      lines.push(`- **${item.count}x** ${item.description.slice(0, 70)}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("*Reply with session ID to see full context*");

  return lines.join("\n");
}

function delta(n: number): string {
  if (n > 0) return chalk.green(`+${n}`);
  if (n < 0) return chalk.red(`${n}`);
  return chalk.gray("0");
}

function deltaCost(n: number): string {
  if (n > 0) return chalk.red(`+$${n.toFixed(2)}`);
  if (n < 0) return chalk.green(`-$${Math.abs(n).toFixed(2)}`);
  return chalk.gray("$0.00");
}

/**
 * Format a digest diff for terminal output (#9).
 */
export function formatDiffPretty(diff: DigestDiff): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white("Digest Comparison"));
  lines.push(chalk.gray(`Current:  ${diff.current.window.since.slice(0, 10)} → ${diff.current.window.until.slice(0, 10)}`));
  lines.push(chalk.gray(`Previous: ${diff.previous.window.since.slice(0, 10)} → ${diff.previous.window.until.slice(0, 10)}`));
  lines.push("");

  // Summary deltas
  lines.push(chalk.bold("  Changes"));
  lines.push(`    Sessions: ${diff.current.totalSessions} (${delta(diff.sessionDelta)})`);
  lines.push(`    Prompts:  ${diff.current.totalPrompts} (${delta(diff.promptDelta)})`);
  lines.push(`    Tokens:   ${delta(diff.tokenDelta.input)} in / ${delta(diff.tokenDelta.output)} out`);
  lines.push(`    Cost:     ${deltaCost(diff.tokenDelta.costDelta)}`);
  lines.push(`    API:      ${delta(diff.tokenDelta.apiCalls)} calls`);
  lines.push("");

  // Category deltas
  lines.push(chalk.bold("  Category Trends"));
  const allCats: DigestCategory[] = ["SKILLS", "AGENTS", "SCHEDULED_TASKS", "CLAUDE_MD"];
  for (const cat of allCats) {
    const d = diff.categoryDeltas[cat];
    const color = CATEGORY_COLORS[cat];
    const label = cat.padEnd(16);
    const arrow = d > 0 ? chalk.green("▲") : d < 0 ? chalk.red("▼") : chalk.gray("─");
    lines.push(`    ${arrow} ${(chalk as any)[color](label)} ${delta(d)}`);
  }
  lines.push("");

  // New items
  if (diff.newItems.length > 0) {
    lines.push(chalk.green.bold(`  New This Period (${diff.newItems.length})`));
    for (const item of diff.newItems.slice(0, 5)) {
      lines.push(`    ${chalk.green("+")} ${item.count}x ${item.description.slice(0, 60)}`);
    }
    if (diff.newItems.length > 5) {
      lines.push(chalk.gray(`    ... and ${diff.newItems.length - 5} more`));
    }
    lines.push("");
  }

  // Trending up
  if (diff.trendingUp.length > 0) {
    lines.push(chalk.yellow.bold(`  Trending Up (${diff.trendingUp.length})`));
    for (const item of diff.trendingUp.slice(0, 5)) {
      lines.push(`    ${chalk.green("▲")} ${item.count}x ${item.description.slice(0, 60)}`);
    }
    lines.push("");
  }

  // Dropped
  if (diff.droppedItems.length > 0) {
    lines.push(chalk.red.bold(`  Dropped (${diff.droppedItems.length})`));
    for (const item of diff.droppedItems.slice(0, 5)) {
      lines.push(`    ${chalk.red("−")} ${item.count}x ${item.description.slice(0, 60)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

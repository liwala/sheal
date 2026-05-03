/**
 * `sheal cost` — Sophisticated token cost dashboard.
 *
 * Full breakdown: per model, per project, per project×model matrix,
 * cost type breakdown (input/output/cache), plan savings.
 */

import chalk from "chalk";
import { loadSessionsInWindow, parseSince } from "../digest/loader.js";
import { estimateCost } from "../digest/cost.js";
import type { ModelCostBreakdown } from "../digest/cost.js";
import type { AgentScanStatus, CostEstimate, TokenSummary } from "../digest/types.js";

export interface CostOptions {
  since: string;
  project?: string;
  format: string;
  plan?: string;
}

export interface CostData {
  tokens: TokenSummary;
  cost: CostEstimate & { byModelBreakdown: ModelCostBreakdown[] };
  sessionCount: number;
  agentScans: AgentScanStatus[];
}

export interface BuildCostOptions {
  since: string;
  project?: string;
  plan?: string;
  /** Where to write progress output (default: console.error). */
  log?: (msg: string) => void;
}

/**
 * Load sessions in a window and compute the per-model/per-project cost breakdown.
 * Returns null when no sessions are found (caller decides what to print).
 */
export function buildCostData(opts: BuildCostOptions): CostData | null {
  const log = opts.log ?? ((s: string) => console.error(s));
  const sinceDate = parseSince(opts.since);

  log(chalk.gray(`Scanning sessions since ${sinceDate.toISOString().slice(0, 10)}...`));

  const { tokens, sessionCount, agentScans } = loadSessionsInWindow({
    since: sinceDate,
    projectFilter: opts.project,
  });

  if (sessionCount === 0) {
    log(chalk.yellow("No sessions found."));
    return null;
  }

  const cost = estimateCost(tokens, opts.plan);
  return { tokens, cost, sessionCount, agentScans };
}

// ── Formatting helpers ──────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n < 0.001) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${((part / whole) * 100).toFixed(0)}%`;
}

function hbar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "\u2588".repeat(Math.min(filled, width)) + "\u2591".repeat(width - Math.min(filled, width));
}

function sparkCostType(m: ModelCostBreakdown): string {
  const total = m.totalCost || 1;
  const parts = [
    { label: "in", cost: m.inputCost, color: chalk.yellow },
    { label: "out", cost: m.outputCost, color: chalk.green },
    { label: "c-r", cost: m.cacheReadCost, color: chalk.blue },
    { label: "c-w", cost: m.cacheWriteCost, color: chalk.cyan },
  ];
  return parts
    .filter(p => p.cost > 0)
    .map(p => p.color(`${p.label} ${pct(p.cost, total)}`))
    .join(chalk.gray(" | "));
}

// ── Main ────────────────────────────────────────────────────────────────

/**
 * Render a CostData object as the ANSI-formatted dashboard string.
 */
export function formatCostPretty(data: CostData, opts: { since: string }): string {
  const { tokens, cost, sessionCount, agentScans } = data;
  const sinceDate = parseSince(opts.since);

  const L: string[] = [];
  const W = 72;
  const line = () => L.push(chalk.gray("─".repeat(W)));
  const section = (title: string) => { L.push(""); L.push(chalk.bold.white(`  ${title}`)); };

  // ── Header ──
  L.push("");
  L.push(chalk.bold.white("  ╔══════════════════════════════════════════════════════════════╗"));
  L.push(chalk.bold.white("  ║") + chalk.bold.yellowBright("              TOKEN COST DASHBOARD                            ") + chalk.bold.white("║"));
  L.push(chalk.bold.white("  ╚══════════════════════════════════════════════════════════════╝"));
  L.push("");
  L.push(chalk.gray(`  ${sinceDate.toISOString().slice(0, 10)} → ${new Date().toISOString().slice(0, 10)}  |  ${sessionCount} sessions  |  ${Object.keys(tokens.byModel).length} models`));

  // ── Grand Total ──
  section("TOTAL");
  L.push("");
  L.push(`    ${chalk.bold.yellowBright(fmtCost(cost.totalCost))}  estimated API cost`);
  L.push("");
  L.push(`    ${chalk.yellow("↑ " + fmt(tokens.totalInput).padStart(7))} input     ${chalk.green("↓ " + fmt(tokens.totalOutput).padStart(7))} output`);
  L.push(`    ${chalk.blue("◆ " + fmt(tokens.totalCacheRead).padStart(7))} cache-rd  ${chalk.cyan("◇ " + fmt(tokens.totalCacheCreate).padStart(7))} cache-wr`);
  L.push(`    ${chalk.white("⚡" + String(tokens.totalApiCalls).padStart(7))} API calls`);

  // ── Per Model Breakdown ──
  if (cost.byModelBreakdown.length > 0) {
    section("BY MODEL");
    L.push("");
    const maxModelCost = Math.max(...cost.byModelBreakdown.map(m => m.totalCost), 0.01);

    for (const m of cost.byModelBreakdown) {
      const share = pct(m.totalCost, cost.totalCost);
      L.push(`    ${chalk.white(hbar(m.totalCost, maxModelCost, 18))} ${chalk.bold(m.displayName.padEnd(14))} ${chalk.yellowBright(fmtCost(m.totalCost).padStart(8))}  ${chalk.gray(share.padStart(4))}  ${chalk.gray(String(m.apiCalls) + " calls")}`);

      // Cost type breakdown spark
      L.push(chalk.gray(`      ${sparkCostType(m)}`));

      // Token detail line
      L.push(chalk.gray(`      ↑${fmt(m.inputTokens).padStart(6)} ${fmtCost(m.inputCost).padStart(7)}  ↓${fmt(m.outputTokens).padStart(6)} ${fmtCost(m.outputCost).padStart(7)}  ◆${fmt(m.cacheReadTokens).padStart(6)} ${fmtCost(m.cacheReadCost).padStart(7)}  ◇${fmt(m.cacheCreateTokens).padStart(6)} ${fmtCost(m.cacheWriteCost).padStart(7)}`));
      L.push("");
    }
  }

  // ── Per Project ──
  const projectEntries = Object.entries(cost.byProject)
    .sort(([, a], [, b]) => b - a);

  if (projectEntries.length > 0) {
    section("BY PROJECT");
    L.push("");
    const maxProjCost = Math.max(...projectEntries.map(([, c]) => c), 0.01);

    for (const [project, projCost] of projectEntries) {
      const data = tokens.byProject[project];
      const share = pct(projCost, cost.totalCost);
      L.push(`    ${chalk.white(hbar(projCost, maxProjCost, 18))} ${chalk.bold(project.padEnd(20).slice(0, 20))} ${chalk.yellowBright(fmtCost(projCost).padStart(8))}  ${chalk.gray(share.padStart(4))}  ${chalk.gray(data.sessionCount + "s")}`);
    }
    L.push("");

    // ── Project × Model Matrix ──
    const projectModelData = tokens.byProjectModel;
    if (projectModelData && Object.keys(projectModelData).length > 0) {
      section("PROJECT × MODEL MATRIX");
      L.push("");

      // Collect all models used
      const allModels = new Set<string>();
      for (const models of Object.values(projectModelData)) {
        for (const m of Object.keys(models)) allModels.add(m);
      }
      const modelList = [...allModels].sort();

      // Pretty model names for column headers
      const prettyModel = (m: string): string => {
        if (/opus.*(4-[5-9]|4\.[5-9])/i.test(m)) return "Opus4.6";
        if (/opus/i.test(m)) return "Opus4";
        if (/sonnet/i.test(m)) return "Son4.6";
        if (/haiku/i.test(m)) return "Haiku";
        return m.slice(0, 8);
      };

      // Header row
      const COL = 10;
      const projCol = 18;
      const header = "    " + "".padEnd(projCol) + modelList.map(m => chalk.bold(prettyModel(m).padStart(COL))).join("");
      L.push(header);

      // Data rows — sorted by total cost
      const sortedProjects = Object.entries(projectModelData)
        .map(([proj, models]) => {
          let total = 0;
          for (const [model, data] of Object.entries(models)) {
            const pricing = cost.byModelBreakdown.find(b => b.model === model);
            if (pricing && pricing.apiCalls > 0) {
              const costPerCall = pricing.totalCost / pricing.apiCalls;
              total += data.apiCalls * costPerCall;
            }
          }
          return { proj, models, total };
        })
        .sort((a, b) => b.total - a.total);

      for (const { proj, models } of sortedProjects) {
        let row = "    " + chalk.gray(proj.padEnd(projCol).slice(0, projCol));
        for (const model of modelList) {
          const data = models[model];
          if (data) {
            const pricing = cost.byModelBreakdown.find(b => b.model === model);
            let cellCost = 0;
            if (pricing && pricing.apiCalls > 0) {
              cellCost = (pricing.totalCost / pricing.apiCalls) * data.apiCalls;
            }
            row += cellCost > 0.01
              ? chalk.yellowBright(fmtCost(cellCost).padStart(COL))
              : chalk.gray(fmtCost(cellCost).padStart(COL));
          } else {
            row += chalk.gray("·".padStart(COL));
          }
        }
        L.push(row);
      }
    }
  }

  // ── Cost Type Pie ──
  if (cost.byModelBreakdown.length > 0) {
    section("COST BREAKDOWN BY TYPE");
    L.push("");

    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    for (const m of cost.byModelBreakdown) {
      totalInput += m.inputCost;
      totalOutput += m.outputCost;
      totalCacheRead += m.cacheReadCost;
      totalCacheWrite += m.cacheWriteCost;
    }
    const total = totalInput + totalOutput + totalCacheRead + totalCacheWrite;
    const maxType = Math.max(totalInput, totalOutput, totalCacheRead, totalCacheWrite, 0.01);

    const typeRows = [
      { label: "Input       ", cost: totalInput, color: chalk.yellow, icon: "↑" },
      { label: "Output      ", cost: totalOutput, color: chalk.green, icon: "↓" },
      { label: "Cache Read  ", cost: totalCacheRead, color: chalk.blue, icon: "◆" },
      { label: "Cache Write ", cost: totalCacheWrite, color: chalk.cyan, icon: "◇" },
    ];

    for (const t of typeRows) {
      L.push(`    ${t.color(t.icon)} ${chalk.bold(t.label)} ${t.color(hbar(t.cost, maxType, 20))} ${chalk.yellowBright(fmtCost(t.cost).padStart(8))}  ${chalk.gray(pct(t.cost, total).padStart(4))}`);
    }
  }

  // ── Agent Status ──
  section("AGENTS SCANNED");
  L.push("");
  for (const scan of agentScans) {
    if (scan.available) {
      L.push(`    ${chalk.green("●")} ${chalk.bold(scan.agent.padEnd(8))} ${scan.projectCount}p  ${scan.sessionCount}s`);
    } else {
      L.push(`    ${chalk.red("●")} ${chalk.bold(scan.agent.padEnd(8))} ${chalk.gray(scan.error || "not available")}`);
    }
  }

  // ── Plan Savings ──
  if (cost.planSavings) {
    const s = cost.planSavings;
    L.push("");
    line();
    L.push("");

    if (s.saved > 0) {
      const savePct = s.savedPercent.toFixed(0);
      L.push(chalk.bold.green(`  🔥 SUBSCRIPTION SAVINGS`));
      L.push("");
      L.push(`    ${s.planName}:  ${chalk.cyan(`$${s.planCost}/mo`)}`);
      L.push(`    API cost:  ${chalk.yellow(fmtCost(s.apiCost))}`);
      L.push(`    Saved:     ${chalk.bold.green(fmtCost(s.saved))} (${chalk.bold.green(savePct + "%")})`);
      L.push("");

      // Fun visual for savings
      const savingsBar = hbar(s.saved, s.apiCost, 30);
      L.push(`    ${chalk.green(savingsBar)} ${chalk.bold.green("saved")} vs ${chalk.gray(hbar(s.planCost, s.apiCost, 30))} ${chalk.gray("paid")}`);
    } else {
      L.push(chalk.gray(`  💡 API would be cheaper by ${fmtCost(Math.abs(s.saved))}`));
    }
  }

  L.push("");
  return L.join("\n");
}

export async function runCost(options: CostOptions): Promise<void> {
  const log = options.format === "json" ? console.error : console.log;
  const data = buildCostData({
    since: options.since,
    project: options.project,
    plan: options.plan,
    log,
  });
  if (!data) return;

  if (options.format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(formatCostPretty(data, { since: options.since }));
}

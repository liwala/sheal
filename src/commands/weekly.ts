/**
 * `sheal weekly` — Run digest + cost as one report, optionally with
 * deep agent analysis and a Slack ping.
 *
 * Replaces the old bin/sheal-weekly-digest.sh shell script; uses the
 * native digest/cost helpers directly so there's no execFileSync hop
 * and no bash/curl/python3 dependency.
 */

import chalk from "chalk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildDigestReport, saveDigestReport } from "./digest.js";
import { formatPretty as formatDigestPretty, formatMarkdown as formatDigestMarkdown } from "../digest/formatter.js";
import { buildCostData, formatCostPretty } from "./cost.js";
import type { CostData } from "./cost.js";
import { detectAgentCli, invokeAgent } from "../retro/agent.js";

export interface WeeklyOptions {
  since: string;
  project?: string;
  plan?: string;
  slack?: boolean;
  agent?: boolean;
}

const ANALYSIS_PROMPT_INTRO = `You are analyzing a weekly AI coding session digest. Read the following digest and cost data, then provide:

1. TOP INSIGHTS: What are the 3 most important patterns you see?
2. AUTOMATION OPPORTUNITIES: Which uncategorized items should be automated?
3. COST OPTIMIZATION: Where is money being wasted? Which projects are expensive relative to their value?
4. RECOMMENDATIONS: 5 specific, actionable recommendations for next week.

Be specific, cite session IDs and exact numbers.`;

function buildAnalysisPrompt(digestMd: string, costJson: string): string {
  return `${ANALYSIS_PROMPT_INTRO}\n\n--- DIGEST ---\n${digestMd}\n\n--- COST DATA ---\n${costJson}\n`;
}

function buildSlackBlocks(input: {
  cost: CostData["cost"];
  sessionCount: number;
  digestPath: string;
  since: string;
  date: string;
}): unknown {
  const totalCost = `$${input.cost.totalCost.toFixed(2)}`;
  const savings = input.cost.planSavings
    ? `$${input.cost.planSavings.saved.toFixed(0)} (${input.cost.planSavings.savedPercent.toFixed(0)}%)`
    : "n/a";
  return {
    blocks: [
      { type: "header", text: { type: "plain_text", text: `Weekly Claude Digest - ${input.date}` } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Window:* ${input.since} | *Sessions:* ${input.sessionCount} | *API Cost:* ${totalCost}\n*Saved vs subscription:* ${savings}`,
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Full report saved to \`${input.digestPath}\`\nRun \`sheal browse digests\` to view interactively.`,
        },
      },
    ],
  };
}

function header(title: string): void {
  console.log(chalk.bold.white("============================================"));
  console.log(chalk.bold.white(`  ${title}`));
  console.log(chalk.bold.white("============================================"));
}

export async function runWeekly(opts: WeeklyOptions): Promise<void> {
  const outDir = join(homedir(), ".sheal", "weekly-digests");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const date = ts.slice(0, 10);
  const scope = opts.project ?? "global";

  header("SHEAL WEEKLY DIGEST");
  console.log(chalk.gray(`  ${new Date().toLocaleString()}`));
  console.log(chalk.gray(`  Window: ${opts.since} | Scope: ${scope}`));
  console.log();

  // 1. Digest — work once, render twice.
  console.log(chalk.bold("[1/4] Generating digest with LLM enrichment..."));
  const digestReport = await buildDigestReport({
    since: opts.since,
    project: opts.project,
    enrich: true,
    log: (s) => console.log(s),
  });
  if (!digestReport) {
    console.log(chalk.yellow("Cannot continue without digest data."));
    return;
  }
  console.log(formatDigestPretty(digestReport));

  const digestMd = formatDigestMarkdown(digestReport);
  const digestPath = join(outDir, `${ts}-${scope}-digest.md`);
  writeFileSync(digestPath, digestMd, "utf-8");
  console.log(chalk.gray(`  Saved: ${digestPath}`));

  // Also save the JSON snapshot so `sheal browse digests` can find this run.
  saveDigestReport(join(homedir(), ".sheal", "digests"), digestReport);

  // 2. Cost — work once, render twice.
  console.log();
  console.log(chalk.bold("[2/4] Generating cost report..."));
  const costData = buildCostData({
    since: opts.since,
    project: opts.project,
    plan: opts.plan,
    log: (s) => console.log(s),
  });
  if (!costData) {
    console.log(chalk.yellow("Cannot generate cost report."));
    return;
  }
  console.log(formatCostPretty(costData, { since: opts.since }));

  const costJson = JSON.stringify(costData, null, 2);
  const costPath = join(outDir, `${ts}-${scope}-cost.json`);
  writeFileSync(costPath, costJson, "utf-8");
  console.log(chalk.gray(`  Saved: ${costPath}`));

  // 3. Optional deep agent analysis.
  console.log();
  if (opts.agent) {
    console.log(chalk.bold("[3/4] Running deep analysis with Claude..."));
    const cli = await detectAgentCli();
    if (!cli) {
      console.log(chalk.yellow("  No agent CLI detected; skipping deep analysis."));
    } else {
      const prompt = buildAnalysisPrompt(digestMd, costJson);
      const result = await invokeAgent(cli, prompt, 180_000);
      if (result.success && result.output) {
        const analysisPath = join(outDir, `${ts}-${scope}-analysis.md`);
        writeFileSync(analysisPath, result.output, "utf-8");
        console.log();
        header("DEEP ANALYSIS");
        console.log(result.output);
        console.log();
        console.log(chalk.gray(`  Saved: ${analysisPath}`));
      } else {
        console.log(chalk.yellow(`  Analysis failed: ${result.error ?? "empty output"}`));
      }
    }
  } else {
    console.log(chalk.gray("[3/4] Skipping deep analysis (use --agent to enable)"));
  }

  // 4. Optional Slack notification.
  console.log();
  if (opts.slack) {
    console.log(chalk.bold("[4/4] Sending to Slack..."));
    const url = process.env.SHEAL_SLACK_WEBHOOK_URL;
    if (!url) {
      console.log(chalk.yellow("  SHEAL_SLACK_WEBHOOK_URL not set; skipping Slack."));
    } else {
      const payload = buildSlackBlocks({
        cost: costData.cost,
        sessionCount: costData.sessionCount,
        digestPath,
        since: opts.since,
        date,
      });
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          console.log(chalk.gray("  Sent to Slack."));
        } else {
          console.log(chalk.yellow(`  Slack webhook returned HTTP ${res.status}`));
        }
      } catch (err) {
        console.log(chalk.yellow(`  Slack request failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  } else {
    console.log(chalk.gray("[4/4] Skipping Slack (use --slack to enable)"));
  }

  console.log();
  header("DONE");
  console.log(chalk.gray(`  Reports: ${outDir}/${ts}-${scope}-*`));
  console.log(chalk.gray("  Browse:  sheal browse digests"));
}

import chalk from "chalk";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";
import { hasNativeTranscripts, listNativeSessions, loadNativeSession } from "../entire/claude-native.js";
import { runRetrospective } from "../retro/index.js";
import { getGlobalDir, getProjectDir, listLearnings } from "../learn/index.js";
import { detectDrift } from "../drift/index.js";
import type { Retrospective } from "../retro/types.js";
import type { DriftReport } from "../drift/index.js";

export interface DriftOptions {
  projectRoot: string;
  last: number;
  format: string;
}

/**
 * Load enrichment files from .sheal/retros/ for Recurring section parsing.
 */
function loadEnrichments(projectRoot: string): Array<{ sessionId: string; content: string }> {
  const retroDir = join(projectRoot, ".sheal", "retros");
  if (!existsSync(retroDir)) return [];

  return readdirSync(retroDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      sessionId: f.replace(/\.md$/, "").replace(/\.[^.]+$/, ""), // strip agent suffix
      content: readFileSync(join(retroDir, f), "utf-8"),
    }));
}

/**
 * Run retro analysis on recent sessions and return Retrospective objects.
 */
async function analyzeRecentSessions(repoPath: string, count: number): Promise<Retrospective[]> {
  const retros: Retrospective[] = [];

  // Try native sessions first
  if (hasNativeTranscripts(repoPath)) {
    const sessions = listNativeSessions(repoPath);
    for (const info of sessions.slice(0, count)) {
      try {
        const cp = loadNativeSession(repoPath, info.sessionId);
        if (cp && cp.sessions[0]?.transcript.length > 0) {
          retros.push(runRetrospective(cp));
        }
      } catch { /* skip bad sessions */ }
    }
  }

  // Also try Entire.io
  const hasBranch = await hasEntireBranch(repoPath);
  if (hasBranch) {
    const checkpoints = await listCheckpoints(repoPath);
    for (const info of checkpoints.slice(0, count)) {
      try {
        const cp = await loadCheckpoint(repoPath, info.checkpointId);
        if (cp && cp.sessions[0]?.transcript.length > 0) {
          retros.push(runRetrospective(cp));
        }
      } catch { /* skip bad checkpoints */ }
    }
  }

  return retros;
}

function formatReport(report: DriftReport): void {
  console.log();
  console.log(chalk.bold("Learning Drift Report"));
  console.log(chalk.gray(`Analyzed ${report.sessionsAnalyzed} recent session(s)`));
  console.log();

  if (report.drifted.length === 0) {
    console.log(chalk.green("No drift detected — all learnings appear to be holding."));
    console.log(chalk.gray(`${report.healthy.length} active learning(s) checked.`));
    return;
  }

  console.log(chalk.red.bold(`${report.drifted.length} learning(s) drifting:`));
  console.log();

  for (const match of report.drifted) {
    const count = match.violations.length;
    const severity = count >= 3 ? chalk.red("●●●") : count >= 2 ? chalk.yellow("●●") : chalk.yellow("●");
    console.log(`${severity} ${chalk.bold(match.learning.id)}: ${match.learning.title}`);

    // Deduplicate violations by evidence
    const seen = new Set<string>();
    for (const v of match.violations) {
      const key = v.evidence;
      if (seen.has(key)) continue;
      seen.add(key);
      const session = v.sessionId.slice(0, 12);
      console.log(chalk.gray(`    ${session}: ${v.evidence}`));
    }
    console.log();
  }

  if (report.healthy.length > 0) {
    console.log(chalk.green(`${report.healthy.length} learning(s) healthy (no violations detected).`));
  }
}

export async function runDrift(options: DriftOptions): Promise<void> {
  const repoPath = options.projectRoot;

  // Load all active learnings (global + project)
  const globalLearnings = listLearnings(getGlobalDir());
  const projectDir = getProjectDir(repoPath);
  const projectLearnings = existsSync(projectDir) ? listLearnings(projectDir) : [];
  const allLearnings = [...globalLearnings, ...projectLearnings]
    .filter((l) => l.status === "active");

  if (allLearnings.length === 0) {
    console.log(chalk.yellow("No active learnings to check. Run 'sheal retro --enrich' to generate some."));
    return;
  }

  console.log(chalk.gray(`Checking ${allLearnings.length} active learning(s) against last ${options.last} session(s)...`));

  // Analyze recent sessions
  const retros = await analyzeRecentSessions(repoPath, options.last);

  if (retros.length === 0) {
    console.log(chalk.yellow("No session data found. Run some coding sessions first."));
    return;
  }

  // Load enrichment files for Recurring section parsing
  const enrichments = loadEnrichments(repoPath);

  // Detect drift
  const report = detectDrift(allLearnings, retros, enrichments);

  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    formatReport(report);
  }
}

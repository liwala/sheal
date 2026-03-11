import chalk from "chalk";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";

export interface SessionsOptions {
  format: string;
  projectRoot: string;
  checkpointId?: string;
}

export async function runSessions(options: SessionsOptions): Promise<void> {
  const repoPath = options.projectRoot;

  const hasBranch = await hasEntireBranch(repoPath);
  if (!hasBranch) {
    if (options.format === "json") {
      console.log(JSON.stringify({ error: "No Entire.io data found", hint: "Install Entire.io and capture some sessions first" }));
    } else {
      console.log();
      console.log(chalk.yellow("No Entire.io data found."));
      console.log(chalk.gray("Install Entire.io (https://github.com/entireio/cli) and capture some sessions first."));
      console.log(chalk.gray("The entire/checkpoints/v1 branch will appear after your first committed checkpoint."));
      console.log();
    }
    return;
  }

  // Load a specific checkpoint
  if (options.checkpointId) {
    const checkpoint = await loadCheckpoint(repoPath, options.checkpointId);
    if (!checkpoint) {
      console.error(chalk.red(`Checkpoint ${options.checkpointId} not found`));
      process.exitCode = 1;
      return;
    }

    if (options.format === "json") {
      console.log(JSON.stringify(checkpoint, null, 2));
    } else {
      printCheckpointDetail(checkpoint);
    }
    return;
  }

  // List all checkpoints
  const checkpoints = await listCheckpoints(repoPath);

  if (checkpoints.length === 0) {
    console.log(chalk.yellow("No checkpoints found on the Entire.io branch."));
    return;
  }

  if (options.format === "json") {
    console.log(JSON.stringify({ checkpoints }, null, 2));
  } else {
    console.log();
    console.log(chalk.bold(`Found ${checkpoints.length} checkpoint(s)`));
    console.log(chalk.gray("─".repeat(50)));
    for (const cp of checkpoints) {
      const agent = cp.agent ? chalk.blue(`[${cp.agent}]`) : "";
      const files = cp.filesTouched.length > 0
        ? chalk.gray(` (${cp.filesTouched.length} files)`)
        : "";
      console.log(`  ${chalk.cyan(cp.checkpointId)} ${agent}${files}`);
      if (cp.filesTouched.length > 0) {
        for (const f of cp.filesTouched.slice(0, 5)) {
          console.log(chalk.gray(`    ${f}`));
        }
        if (cp.filesTouched.length > 5) {
          console.log(chalk.gray(`    ... and ${cp.filesTouched.length - 5} more`));
        }
      }
    }
    console.log();
    console.log(chalk.gray("Use: sheal sessions --checkpoint <id> for details"));
    console.log();
  }
}

function printCheckpointDetail(checkpoint: import("../entire/types.js").Checkpoint): void {
  const { root, sessions } = checkpoint;

  console.log();
  console.log(chalk.bold(`Checkpoint: ${root.checkpointId}`));
  console.log(chalk.gray("─".repeat(50)));
  console.log(`  Strategy: ${root.strategy}`);
  if (root.branch) console.log(`  Branch: ${root.branch}`);
  console.log(`  Sessions: ${sessions.length}`);
  console.log(`  Files touched: ${root.filesTouched.length}`);

  if (root.tokenUsage) {
    const tu = root.tokenUsage;
    console.log(`  Tokens: ${tu.inputTokens} in / ${tu.outputTokens} out (${tu.apiCallCount} API calls)`);
  }

  for (const session of sessions) {
    console.log();
    console.log(chalk.blue(`  Session: ${session.metadata.sessionId}`));
    if (session.metadata.agent) console.log(`    Agent: ${session.metadata.agent}`);
    if (session.metadata.model) console.log(`    Model: ${session.metadata.model}`);
    console.log(`    Created: ${session.metadata.createdAt}`);
    console.log(`    Transcript entries: ${session.transcript.length}`);
    console.log(`    Prompts: ${session.prompts.length}`);

    if (session.metadata.summary) {
      const s = session.metadata.summary;
      console.log();
      console.log(chalk.bold("    Summary:"));
      console.log(`      Intent: ${s.intent}`);
      console.log(`      Outcome: ${s.outcome}`);
      if (s.friction.length > 0) {
        console.log(chalk.yellow("      Friction:"));
        for (const f of s.friction) console.log(chalk.yellow(`        - ${f}`));
      }
      if (s.learnings.repo.length > 0) {
        console.log(chalk.green("      Learnings (repo):"));
        for (const l of s.learnings.repo) console.log(chalk.green(`        - ${l}`));
      }
      if (s.openItems.length > 0) {
        console.log(chalk.gray("      Open items:"));
        for (const o of s.openItems) console.log(chalk.gray(`        - ${o}`));
      }
    }

    if (session.metadata.initialAttribution) {
      const a = session.metadata.initialAttribution;
      console.log(`    Attribution: ${a.agentPercentage.toFixed(1)}% agent (${a.agentLines} lines)`);
    }
  }
  console.log();
}

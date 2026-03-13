import chalk from "chalk";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";
import { runRetrospective } from "../retro/index.js";
import { generateRetroPrompt } from "../retro/prompt.js";
import type { Retrospective, Learning } from "../retro/types.js";

export interface RetroOptions {
  format: string;
  projectRoot: string;
  checkpointId?: string;
  prompt?: boolean;
}

export async function runRetro(options: RetroOptions): Promise<void> {
  const repoPath = options.projectRoot;

  const hasBranch = await hasEntireBranch(repoPath);
  if (!hasBranch) {
    console.log(chalk.yellow("No Entire.io data found. Run some sessions with Entire.io enabled first."));
    return;
  }

  // If no checkpoint specified, use the latest one
  let checkpointId = options.checkpointId;
  if (!checkpointId) {
    const checkpoints = await listCheckpoints(repoPath);
    if (checkpoints.length === 0) {
      console.log(chalk.yellow("No checkpoints found."));
      return;
    }
    // Use the first one (most recent based on branch order)
    checkpointId = checkpoints[0].checkpointId;
  }

  const checkpoint = await loadCheckpoint(repoPath, checkpointId);
  if (!checkpoint) {
    console.error(chalk.red(`Checkpoint ${checkpointId} not found`));
    process.exitCode = 1;
    return;
  }

  if (checkpoint.sessions.length === 0 || checkpoint.sessions[0].transcript.length === 0) {
    console.log(chalk.yellow(`Checkpoint ${checkpointId} has no transcript data.`));
    console.log(chalk.gray("Transcripts are finalized when a session ends. Try a completed session."));
    return;
  }

  const retro = runRetrospective(checkpoint);

  if (options.prompt) {
    // Output an LLM prompt for deep analysis (pipe to any agent)
    console.log(generateRetroPrompt(retro, checkpoint));
    return;
  }

  if (options.format === "json") {
    // Strip entries from failure loops for cleaner JSON
    const clean = {
      ...retro,
      failureLoops: retro.failureLoops.map(({ entries, ...rest }) => rest),
    };
    console.log(JSON.stringify(clean, null, 2));
  } else {
    printRetro(retro);
  }
}

function printRetro(retro: Retrospective): void {
  console.log();
  console.log(chalk.bold("Session Retrospective"));
  console.log(chalk.gray("═".repeat(50)));

  // Header
  console.log(`  Checkpoint: ${chalk.cyan(retro.checkpointId)}`);
  if (retro.agent) console.log(`  Agent: ${retro.agent}`);
  console.log(`  Session: ${retro.sessionId}`);
  console.log(`  Created: ${retro.createdAt}`);
  console.log();

  // Health score
  const scoreColor = retro.healthScore >= 80 ? chalk.green : retro.healthScore >= 50 ? chalk.yellow : chalk.red;
  console.log(`  Health Score: ${scoreColor(retro.healthScore + "/100")}`);
  console.log();

  // Entire.io summary (if available)
  if (retro.entireSummary) {
    console.log(chalk.bold("  AI Summary (from Entire.io):"));
    console.log(`    Intent: ${retro.entireSummary.intent}`);
    console.log(`    Outcome: ${retro.entireSummary.outcome}`);
    if (retro.entireSummary.friction.length > 0) {
      console.log(chalk.yellow("    Friction:"));
      for (const f of retro.entireSummary.friction) console.log(chalk.yellow(`      - ${f}`));
    }
    console.log();
  }

  // Effort breakdown
  console.log(chalk.bold("  Effort Breakdown:"));
  console.log(`    User prompts: ${retro.effort.userPromptCount}`);
  console.log(`    Assistant responses: ${retro.effort.assistantResponseCount}`);
  console.log(`    Files modified: ${Object.keys(retro.effort.fileTouchCounts).length}`);

  if (Object.keys(retro.effort.toolCounts).length > 0) {
    console.log("    Tools:");
    const sorted = Object.entries(retro.effort.toolCounts).sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sorted) {
      console.log(`      ${tool}: ${count}x`);
    }
  }

  if (retro.effort.tokenUsage) {
    const tu = retro.effort.tokenUsage;
    console.log(`    Tokens: ${tu.inputTokens} in / ${tu.outputTokens} out (${tu.apiCallCount} API calls)`);
    if (tu.cacheReadTokens > 0) {
      console.log(`    Cache: ${tu.cacheReadTokens} read / ${tu.cacheCreationTokens} created`);
    }
  }
  console.log();

  // Failure loops
  if (retro.failureLoops.length > 0) {
    console.log(chalk.red.bold("  Failure Loops Detected:"));
    for (const loop of retro.failureLoops) {
      console.log(chalk.red(`    ✗ ${loop.action}: ${loop.retryCount} retries`));
      if (loop.errorPattern) {
        console.log(chalk.gray(`      Error: ${loop.errorPattern.slice(0, 120)}`));
      }
    }
    console.log();
  }

  // Reverted work
  if (retro.revertedWork.length > 0) {
    console.log(chalk.yellow.bold("  Reverted/Churned Work:"));
    for (const rw of retro.revertedWork) {
      console.log(chalk.yellow(`    ! ${rw.wastedOperations} extra operations on ${rw.files.length} file(s)`));
      for (const f of rw.files) {
        console.log(chalk.gray(`      ${f.split("/").pop()}`));
      }
    }
    console.log();
  }

  // Learnings
  if (retro.learnings.length > 0) {
    console.log(chalk.bold("  Learnings:"));
    for (const learning of retro.learnings) {
      const icon = severityIcon(learning);
      console.log(`    ${icon} [${learning.category}] ${learning.description}`);
      console.log(chalk.gray(`      → ${learning.suggestion}`));
    }
    console.log();
  }

  // Hot files
  const hotFiles = Object.entries(retro.effort.fileTouchCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (hotFiles.length > 0) {
    console.log(chalk.bold("  Most-Touched Files:"));
    for (const [file, count] of hotFiles) {
      const bar = "█".repeat(Math.min(count, 20));
      console.log(`    ${chalk.gray(bar)} ${count}x ${file.split("/").pop()}`);
    }
    console.log();
  }

  console.log(chalk.gray("═".repeat(50)));
  console.log();
}

function severityIcon(learning: Learning): string {
  switch (learning.severity) {
    case "high": return chalk.red("●");
    case "medium": return chalk.yellow("●");
    case "low": return chalk.blue("●");
  }
}

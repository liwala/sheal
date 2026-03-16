import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";
import { hasNativeTranscripts, listNativeSessions, loadNativeSession } from "../entire/claude-native.js";
import { runRetrospective } from "../retro/index.js";
import { generateRetroPrompt } from "../retro/prompt.js";
import { detectAgentCli, invokeAgent } from "../retro/agent.js";
import {
  getGlobalDir,
  nextId,
  writeLearning,
  listLearnings,
} from "../learn/index.js";
import { detectProjectTags } from "../learn/detect.js";
import type { LearningFile } from "../learn/types.js";
import type { Retrospective, Learning } from "../retro/types.js";

export interface RetroOptions {
  format: string;
  projectRoot: string;
  checkpointId?: string;
  prompt?: boolean;
  enrich?: boolean;
  agent?: string;
}

export async function runRetro(options: RetroOptions): Promise<void> {
  const repoPath = options.projectRoot;

  // Try Entire.io first, fall back to native Claude Code transcripts
  const checkpoint = await loadSession(repoPath, options.checkpointId);
  if (!checkpoint) return;

  const retro = runRetrospective(checkpoint);

  // Load existing learnings for context
  const globalDir = getGlobalDir();
  const existingLearnings = listLearnings(globalDir);

  if (options.prompt) {
    // Output an LLM prompt for deep analysis (pipe to any agent)
    console.log(generateRetroPrompt(retro, checkpoint, existingLearnings));
    return;
  }

  if (options.enrich) {
    await enrichRetro(retro, checkpoint, options.projectRoot, existingLearnings, options.agent);
    return;
  }

  const cached = loadCachedEnrichment(options.projectRoot, retro.checkpointId);

  if (options.format === "json") {
    // Strip entries from failure loops for cleaner JSON
    const clean = {
      ...retro,
      failureLoops: retro.failureLoops.map(({ entries, ...rest }) => rest),
      ...(cached ? { agentAssessment: cached } : {}),
    };
    console.log(JSON.stringify(clean, null, 2));
  } else {
    printRetro(retro, cached);
  }
}

/**
 * Load a session from Entire.io or native Claude Code transcripts.
 * Returns null if nothing is available (and prints appropriate messages).
 */
async function loadSession(
  repoPath: string,
  requestedId?: string,
): Promise<import("../entire/types.js").Checkpoint | null> {
  // Try Entire.io first
  const hasBranch = await hasEntireBranch(repoPath);
  if (hasBranch) {
    let checkpointId = requestedId;
    if (!checkpointId) {
      const checkpoints = await listCheckpoints(repoPath);
      if (checkpoints.length > 0) {
        checkpointId = checkpoints[0].checkpointId;
      }
    }

    if (checkpointId) {
      const checkpoint = await loadCheckpoint(repoPath, checkpointId);
      if (checkpoint && checkpoint.sessions.length > 0 && checkpoint.sessions[0].transcript.length > 0) {
        return checkpoint;
      }
    }
  }

  // Fall back to native Claude Code transcripts
  if (hasNativeTranscripts(repoPath)) {
    console.log(chalk.gray("No Entire.io data, using native Claude Code transcripts."));

    let sessionId = requestedId;
    if (!sessionId) {
      const sessions = listNativeSessions(repoPath);
      if (sessions.length === 0) {
        console.log(chalk.yellow("No sessions found."));
        return null;
      }
      sessionId = sessions[0].sessionId;
    }

    const checkpoint = loadNativeSession(repoPath, sessionId);
    if (!checkpoint) {
      console.error(chalk.red(`Session ${sessionId} not found`));
      process.exitCode = 1;
      return null;
    }

    if (checkpoint.sessions.length === 0 || checkpoint.sessions[0].transcript.length === 0) {
      console.log(chalk.yellow(`Session ${sessionId} has no transcript data.`));
      return null;
    }

    return checkpoint;
  }

  console.log(chalk.yellow("No session data found."));
  console.log(chalk.gray("Supported sources: Entire.io (entire/checkpoints/v1 branch) or native Claude Code (~/.claude/projects/)."));
  return null;
}

function enrichmentCachePath(projectRoot: string, checkpointId: string): string {
  return join(projectRoot, ".sheal", "retros", `${checkpointId}.md`);
}

function saveEnrichment(projectRoot: string, checkpointId: string, content: string): void {
  const dir = join(projectRoot, ".sheal", "retros");
  mkdirSync(dir, { recursive: true });
  writeFileSync(enrichmentCachePath(projectRoot, checkpointId), content, "utf-8");
}

function loadCachedEnrichment(projectRoot: string, checkpointId: string): string | null {
  const path = enrichmentCachePath(projectRoot, checkpointId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

function printRetro(retro: Retrospective, agentAssessment?: string | null): void {
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

  // Agent assessment (if available)
  if (agentAssessment) {
    console.log(chalk.bold("  Agent Assessment:"));
    for (const line of agentAssessment.split("\n")) {
      console.log(`    ${line}`);
    }
    console.log();
  } else {
    console.log(chalk.gray("  No agent assessment cached. Run with --enrich to generate one."));
    console.log();
  }

  console.log(chalk.gray("═".repeat(50)));
  console.log();
}

async function enrichRetro(retro: Retrospective, checkpoint: import("../entire/types.js").Checkpoint, projectRoot: string, existingLearnings: LearningFile[], agentOverride?: string): Promise<void> {
  const session = checkpoint.sessions[0];
  const agentType = agentOverride ?? session?.metadata.agent;

  console.log(chalk.gray(`Detecting agent CLI (session agent: ${agentType ?? "unknown"})...`));
  const cli = await detectAgentCli(agentType);

  if (!cli) {
    console.log(chalk.yellow("No compatible agent CLI found. Falling back to static analysis."));
    console.log(chalk.gray("Supported: claude, gemini, codex"));
    console.log(chalk.gray("\nUse --prompt to generate a prompt you can pipe to any LLM manually."));
    printRetro(retro);
    return;
  }

  console.log(chalk.gray(`Using ${cli.command} for enrichment...`));
  if (existingLearnings.length > 0) {
    console.log(chalk.gray(`Including ${existingLearnings.length} existing learnings for context.`));
  }

  const prompt = generateRetroPrompt(retro, checkpoint, existingLearnings);

  console.log(chalk.gray("Invoking agent for deep analysis (this may take a minute)..."));
  const result = await invokeAgent(cli, prompt);

  if (!result.success) {
    console.log(chalk.red(`Agent invocation failed: ${result.error}`));
    console.log(chalk.gray("Falling back to static-only retro.\n"));
    printRetro(retro);
    return;
  }

  // Cache the enrichment
  saveEnrichment(projectRoot, retro.checkpointId, result.output);
  console.log(chalk.gray(`Cached to .sheal/retros/${retro.checkpointId}.md`));

  // Print full retro with agent assessment included
  printRetro(retro, result.output);

  // Extract rules and offer to save as learnings
  const rules = parseRulesFromOutput(result.output);
  if (rules.length > 0) {
    await promptToSaveRules(rules, projectRoot);
  }
}

function severityIcon(learning: Learning): string {
  switch (learning.severity) {
    case "high": return chalk.red("●");
    case "medium": return chalk.yellow("●");
    case "low": return chalk.blue("●");
  }
}

/**
 * Parse rules from the agent's enrichment output.
 * Looks for bullet points under the **Rules:** section.
 */
function parseRulesFromOutput(output: string): string[] {
  // Find the Rules section
  const rulesMatch = output.match(/\*\*Rules:\*\*\s*\n([\s\S]*?)(?:\n\*\*|\n##|$)/);
  if (!rulesMatch) return [];

  const rulesBlock = rulesMatch[1];
  const rules: string[] = [];

  for (const line of rulesBlock.split("\n")) {
    const trimmed = line.trim();
    // Match bullet lines: "- rule text" or "* rule text"
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      rules.push(bulletMatch[1].trim());
    }
  }

  return rules;
}

/**
 * Ask the user to confirm each rule and save confirmed ones as learnings.
 */
async function promptToSaveRules(rules: string[], projectRoot: string): Promise<void> {
  console.log();
  console.log(chalk.bold(`Save ${rules.length} suggested rule(s) as learnings?`));
  console.log(chalk.gray("Each rule will be saved to ~/.sheal/learnings/\n"));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  const projectTags = detectProjectTags(projectRoot);
  const globalDir = getGlobalDir();
  let saved = 0;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    console.log(chalk.cyan(`  ${i + 1}. ${rule}`));
    const answer = await ask(chalk.gray("     Save? [Y/n/q] "));
    const a = answer.trim().toLowerCase();

    if (a === "q") {
      console.log(chalk.gray("  Skipping remaining rules."));
      break;
    }

    if (a === "" || a === "y" || a === "yes") {
      const id = nextId(globalDir);
      const today = new Date().toISOString().slice(0, 10);
      const learning: LearningFile = {
        id,
        title: rule.slice(0, 80),
        date: today,
        tags: projectTags.slice(0, 5), // use detected project tags
        category: "workflow",
        severity: "medium",
        status: "active",
        body: rule,
      };
      const path = writeLearning(globalDir, learning);
      console.log(chalk.green(`     Saved ${id}`));
      saved++;
    } else {
      console.log(chalk.gray("     Skipped."));
    }
  }

  rl.close();

  if (saved > 0) {
    console.log(chalk.green(`\nSaved ${saved} learning(s). Run 'sheal learn list --global' to view.`));
  }
}

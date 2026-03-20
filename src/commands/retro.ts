import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";
import { hasNativeTranscripts, listNativeSessions, loadNativeSession } from "../entire/claude-native.js";
import { hasAmpSessions, listAmpProjects, listAmpSessionsForProject, listAmpThreadFiles, getAmpThreadProjectPath } from "../entire/amp-native.js";
import { runRetrospective } from "../retro/index.js";
import { runAmpRetrospective } from "../retro/amp-retro.js";
import { generateRetroPrompt, generateConsolidationPrompt } from "../retro/prompt.js";
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

  // Check if this is an Amp thread
  if (options.checkpointId?.startsWith("T-")) {
    return runAmpRetro(options);
  }

  // Also check if no specific ID given and we should try Amp as a source
  // (Amp threads are only used when explicitly targeted by ID)

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

  const cached = loadCachedEnrichments(options.projectRoot, retro.checkpointId);

  if (options.format === "json") {
    const clean = {
      ...retro,
      failureLoops: retro.failureLoops.map(({ entries, ...rest }) => rest),
      ...(cached.length > 0 ? { agentAssessments: cached } : {}),
    };
    console.log(JSON.stringify(clean, null, 2));
  } else {
    printRetro(retro, cached);
  }
}

/**
 * Run a retro on an Amp file-change thread.
 * Saves retros to the thread's actual project path, not cwd.
 */
async function runAmpRetro(options: RetroOptions): Promise<void> {
  const threadId = options.checkpointId!;
  const files = listAmpThreadFiles(threadId);

  if (files.length === 0) {
    console.log(chalk.yellow(`No file changes found for Amp thread: ${threadId}`));
    return;
  }

  // Use the thread's actual project path, not cwd
  const projectRoot = getAmpThreadProjectPath(threadId) ?? options.projectRoot;
  if (projectRoot !== options.projectRoot) {
    console.log(chalk.gray(`Amp project: ${projectRoot}`));
  }

  console.log(chalk.gray(`Amp thread: ${threadId} (${files.length} file changes)`));

  const retro = runAmpRetrospective(threadId, files);

  const globalDir = getGlobalDir();
  const existingLearnings = listLearnings(globalDir);

  if (options.prompt) {
    console.log(generateAmpRetroPrompt(retro, files, existingLearnings));
    return;
  }

  if (options.enrich) {
    await enrichAmpRetro(retro, files, projectRoot, existingLearnings, options.agent);
    return;
  }

  const cached = loadCachedEnrichments(projectRoot, retro.checkpointId);

  if (options.format === "json") {
    const clean = {
      ...retro,
      failureLoops: retro.failureLoops.map(({ entries, ...rest }) => rest),
      ...(cached.length > 0 ? { agentAssessments: cached } : {}),
    };
    console.log(JSON.stringify(clean, null, 2));
  } else {
    printRetro(retro, cached);
  }
}

/**
 * Generate a prompt for LLM-enriched Amp retro (file-changes only, no conversation).
 */
function generateAmpRetroPrompt(
  retro: Retrospective,
  files: import("../entire/amp-native.js").AmpFileChange[],
  existingLearnings?: LearningFile[],
): string {
  const diffSummaries = files
    .slice(0, 20) // cap to avoid huge prompts
    .map((f) => {
      const relPath = f.filePath.split("/").slice(-3).join("/");
      const flags = [f.isNewFile ? "NEW" : "MODIFIED", f.reverted ? "REVERTED" : ""].filter(Boolean).join(", ");
      const diffLines = f.diff.split("\n");
      // Show first 30 lines of diff
      const shortDiff = diffLines.slice(0, 30).join("\n");
      const truncated = diffLines.length > 30 ? `\n... (${diffLines.length - 30} more lines)` : "";
      return `### ${relPath} [${flags}]\n\`\`\`diff\n${shortDiff}${truncated}\n\`\`\``;
    })
    .join("\n\n");

  return `You are performing a deep retrospective analysis of a completed AI coding session from Amp.
Amp only stores file changes (diffs), not conversation transcripts. Analyze the diffs to understand what happened.

## Session Data

- Thread: ${retro.checkpointId}
- Agent: Amp
- Health Score: ${retro.healthScore}/100
- Files Changed: ${files.length}
- New Files: ${files.filter((f) => f.isNewFile).length}
- Reverted: ${files.filter((f) => f.reverted).length}
- Duration: ${files.length >= 2 ? `${Math.round((Math.max(...files.map((f) => f.timestamp)) - Math.min(...files.map((f) => f.timestamp))) / 60000)} min` : "N/A"}

## Reverted/Churned Work
${retro.revertedWork.map((r) => `- ${r.files.map((f) => f.split("/").pop()).join(", ")}: ${r.wastedOperations} reverted operations`).join("\n") || "None"}

## Most-Touched Files
${Object.entries(retro.effort.fileTouchCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, c]) => `- ${f.split("/").pop()} (${c}x)`).join("\n")}

## Static Analysis Learnings
${retro.learnings.map((l) => `- [${l.severity}/${l.category}] ${l.description} → ${l.suggestion}`).join("\n") || "None"}

## File Changes (diffs)
${diffSummaries}
${files.length > 20 ? `\n... and ${files.length - 20} more files (omitted for brevity)` : ""}

## Existing Learnings (already captured)
${existingLearnings && existingLearnings.length > 0
    ? existingLearnings.map((l) => `- ${l.id} [${l.category}] ${l.title}`).join("\n")
    : "None yet"}

---

## Your Task

Analyze the file diffs to understand what the Amp session accomplished. Be concise. Respond with ONLY this structure:

**Summary:** 1-2 sentences on what was built/changed and how it went.

**Top Issues:**
For each (max 3), one line: issue → root cause → fix. Focus on reverted files and churn patterns.

**Recurring:** Flag any issues that match existing learnings above. If nothing recurs, write "None".

**Rules:** 3-5 new rules (not duplicating existing learnings above). Format each as a bullet starting with "- ".
Each rule must be a direct instruction to a future AI agent. Be specific and actionable.

**For the Human:** 2-3 observations about how the human could improve their collaboration with the AI agent. Be honest and constructive.
Look at file change patterns: did the session tackle too much at once? Was there excessive churn suggesting unclear direction? Should it have been split into smaller tasks?
Format each as a bullet starting with "- ".`;
}

/**
 * Enrich an Amp retro using an LLM agent.
 */
async function enrichAmpRetro(
  retro: Retrospective,
  files: import("../entire/amp-native.js").AmpFileChange[],
  projectRoot: string,
  existingLearnings: LearningFile[],
  agentOverride?: string,
): Promise<void> {
  const agentNames = agentOverride ? agentOverride.split(",").map((a) => a.trim()) : ["Amp"];
  const prompt = generateAmpRetroPrompt(retro, files, existingLearnings);
  const enrichments = await runMultiAgentEnrichment(agentNames, prompt, projectRoot, retro.checkpointId);

  if (enrichments.length === 0) {
    printRetro(retro);
    return;
  }

  // Consolidate if multiple agents produced results
  const consolidated = await maybeConsolidate(enrichments, projectRoot, retro.checkpointId);
  const allEnrichments = consolidated ? [...enrichments, consolidated] : enrichments;

  printRetro(retro, allEnrichments);

  const ruleSource = consolidated ?? { content: enrichments.map((e) => e.content).join("\n") };
  const allRules = parseRulesFromOutput(ruleSource.content);
  if (allRules.length > 0) {
    await promptToSaveRules(allRules, projectRoot, retro.sessionId);
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
  console.log(chalk.gray("Supported sources: Entire.io, native Claude Code (~/.claude/projects/), Amp (~/.amp/file-changes/)."));
  return null;
}

function enrichmentCachePath(projectRoot: string, checkpointId: string, agent?: string): string {
  const suffix = agent ? `.${agent}` : "";
  return join(projectRoot, ".sheal", "retros", `${checkpointId}${suffix}.md`);
}

function saveEnrichment(projectRoot: string, checkpointId: string, content: string, agent?: string): void {
  const dir = join(projectRoot, ".sheal", "retros");
  mkdirSync(dir, { recursive: true });
  writeFileSync(enrichmentCachePath(projectRoot, checkpointId, agent), content, "utf-8");
}

interface CachedEnrichment {
  agent: string;
  content: string;
}

/**
 * Load all cached enrichments for a checkpoint.
 * Supports both legacy ({id}.md) and per-agent ({id}.claude.md) formats.
 */
function loadCachedEnrichments(projectRoot: string, checkpointId: string): CachedEnrichment[] {
  const dir = join(projectRoot, ".sheal", "retros");
  if (!existsSync(dir)) return [];

  const results: CachedEnrichment[] = [];

  // Check for per-agent files: {id}.{agent}.md
  const agentNames = ["consolidated", "claude", "gemini", "codex", "amp"];
  for (const agent of agentNames) {
    const path = enrichmentCachePath(projectRoot, checkpointId, agent);
    if (existsSync(path)) {
      results.push({ agent, content: readFileSync(path, "utf-8") });
    }
  }

  // Fall back to legacy single file: {id}.md
  if (results.length === 0) {
    const legacyPath = enrichmentCachePath(projectRoot, checkpointId);
    if (existsSync(legacyPath)) {
      results.push({ agent: "agent", content: readFileSync(legacyPath, "utf-8") });
    }
  }

  return results;
}

function printRetro(retro: Retrospective, enrichments?: CachedEnrichment[]): void {
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

  // Human patterns
  if (retro.humanPatterns) {
    const hp = retro.humanPatterns;
    console.log(chalk.bold("  Human Patterns:"));
    console.log(`    Duration: ~${hp.durationMinutes} min`);
    console.log(`    Avg prompt interval: ~${hp.avgPromptIntervalMinutes} min`);
    if (hp.correctionCount > 0) {
      console.log(chalk.yellow(`    Corrections/redirects: ${hp.correctionCount}`));
    }
    if (hp.contextCompacted) {
      console.log(chalk.yellow(`    ⚠ Context was compacted — session hit context limits`));
    }
    if (hp.shortPromptCount > 3) {
      console.log(chalk.gray(`    ${hp.shortPromptCount} very short prompts (<20 chars)`));
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

  // Agent assessments (if available)
  if (enrichments && enrichments.length > 0) {
    for (const e of enrichments) {
      const label = enrichments.length > 1 ? ` (${e.agent})` : "";
      console.log(chalk.bold(`  Agent Assessment${label}:`));
      for (const line of e.content.split("\n")) {
        console.log(`    ${line}`);
      }
      console.log();
    }
  } else {
    console.log(chalk.gray("  No agent assessment cached. Run with --enrich to generate one."));
    console.log();
  }

  console.log(chalk.gray("═".repeat(50)));
  console.log();
}

async function enrichRetro(retro: Retrospective, checkpoint: import("../entire/types.js").Checkpoint, projectRoot: string, existingLearnings: LearningFile[], agentOverride?: string): Promise<void> {
  const session = checkpoint.sessions[0];
  const defaultAgent = session?.metadata.agent ?? "claude";
  const agentNames = agentOverride ? agentOverride.split(",").map((a) => a.trim()) : [defaultAgent];

  if (existingLearnings.length > 0) {
    console.log(chalk.gray(`Including ${existingLearnings.length} existing learnings for context.`));
  }

  const prompt = generateRetroPrompt(retro, checkpoint, existingLearnings);
  const enrichments = await runMultiAgentEnrichment(agentNames, prompt, projectRoot, retro.checkpointId);

  if (enrichments.length === 0) {
    printRetro(retro);
    return;
  }

  // Consolidate if multiple agents produced results
  const consolidated = await maybeConsolidate(enrichments, projectRoot, retro.checkpointId);
  const allEnrichments = consolidated ? [...enrichments, consolidated] : enrichments;

  printRetro(retro, allEnrichments);

  // Parse rules from consolidated output if available, otherwise flatMap individuals
  const ruleSource = consolidated ?? { content: enrichments.map((e) => e.content).join("\n") };
  const allRules = parseRulesFromOutput(ruleSource.content);
  if (allRules.length > 0) {
    await promptToSaveRules(allRules, projectRoot, retro.sessionId);
  }
}

/**
 * Run enrichment with one or more agents in parallel.
 * Returns enrichments for all agents that succeeded.
 */
async function runMultiAgentEnrichment(
  agentNames: string[],
  prompt: string,
  projectRoot: string,
  checkpointId: string,
): Promise<CachedEnrichment[]> {
  // Resolve CLIs for all requested agents
  const agentClis: Array<{ name: string; cli: Awaited<ReturnType<typeof detectAgentCli>> }> = [];
  for (const name of agentNames) {
    console.log(chalk.gray(`Detecting ${name} CLI...`));
    const cli = await detectAgentCli(name);
    if (cli) {
      agentClis.push({ name, cli });
    } else {
      console.log(chalk.yellow(`  ${name}: not available`));
    }
  }

  if (agentClis.length === 0) {
    console.log(chalk.yellow("No compatible agent CLI found."));
    console.log(chalk.gray("Supported: claude, gemini, codex, amp"));
    console.log(chalk.gray("\nUse --prompt to generate a prompt you can pipe to any LLM manually."));
    return [];
  }

  const enrichments: CachedEnrichment[] = [];

  if (agentClis.length === 1) {
    // Single agent — run directly
    const { name, cli } = agentClis[0];
    console.log(chalk.gray(`Invoking ${cli!.command} for deep analysis...`));
    const result = await invokeAgent(cli!, prompt);
    if (result.success) {
      const agentLabel = agentNames.length > 1 ? name : undefined;
      saveEnrichment(projectRoot, checkpointId, result.output, agentLabel);
      console.log(chalk.gray(`Cached to .sheal/retros/${checkpointId}${agentLabel ? `.${agentLabel}` : ""}.md`));
      enrichments.push({ agent: name, content: result.output });
    } else {
      console.log(chalk.red(`${name} failed: ${result.error}`));
    }
  } else {
    // Multiple agents — run in parallel
    console.log(chalk.gray(`Running ${agentClis.length} agents in parallel...`));
    const results = await Promise.all(
      agentClis.map(async ({ name, cli }) => {
        console.log(chalk.gray(`  Invoking ${cli!.command}...`));
        const result = await invokeAgent(cli!, prompt);
        return { name, result };
      }),
    );

    for (const { name, result } of results) {
      if (result.success) {
        saveEnrichment(projectRoot, checkpointId, result.output, name);
        console.log(chalk.green(`  ✓ ${name} — saved to .sheal/retros/${checkpointId}.${name}.md`));
        enrichments.push({ agent: name, content: result.output });
      } else {
        console.log(chalk.red(`  ✗ ${name}: ${result.error}`));
      }
    }
  }

  return enrichments;
}

/**
 * If multiple agents produced enrichments, consolidate them into a single
 * unified assessment using an LLM. Returns the consolidated enrichment,
 * or null if consolidation wasn't needed or failed.
 */
async function maybeConsolidate(
  enrichments: CachedEnrichment[],
  projectRoot: string,
  checkpointId: string,
): Promise<CachedEnrichment | null> {
  if (enrichments.length < 2) return null;

  console.log(chalk.gray(`\nConsolidating ${enrichments.length} agent assessments...`));

  const prompt = generateConsolidationPrompt(
    enrichments.map((e) => ({ agent: e.agent, content: e.content })),
  );

  // Use the first available agent CLI for consolidation
  const cli = await detectAgentCli("claude") ?? await detectAgentCli();
  if (!cli) {
    console.log(chalk.yellow("No agent available for consolidation. Showing individual results."));
    return null;
  }

  const result = await invokeAgent(cli, prompt);
  if (!result.success) {
    console.log(chalk.yellow(`Consolidation failed: ${result.error}`));
    return null;
  }

  saveEnrichment(projectRoot, checkpointId, result.output, "consolidated");
  console.log(chalk.green(`  Consolidated assessment saved to .sheal/retros/${checkpointId}.consolidated.md`));

  return { agent: "consolidated", content: result.output };
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
async function promptToSaveRules(rules: string[], projectRoot: string, sessionId?: string): Promise<void> {
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
        ...(sessionId ? { sessionId } : {}),
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

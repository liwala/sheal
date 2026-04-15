import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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
  /** Run retro on the last N sessions */
  last?: number;
  /** Run retro on all sessions from today */
  today?: boolean;
}

const MIN_USER_PROMPTS = 3;
const RETRO_PATTERNS = [/sheal\s+retro/i, /\/retro/i, /sheal\s+check/i];

/**
 * Check if a session is too trivial to analyze.
 * Returns a reason string if it should be skipped, or null if it's worth analyzing.
 */
function shouldSkipSession(checkpoint: import("../entire/types.js").Checkpoint): string | null {
  const session = checkpoint.sessions[0];
  if (!session) return "no session data";

  const transcript = session.transcript;
  const userEntries = transcript.filter((e) => e.type === "user");
  const filesModified = checkpoint.root.filesTouched?.length ?? 0;

  // Too short
  if (userEntries.length < MIN_USER_PROMPTS && filesModified === 0) {
    return `too short to analyze (${userEntries.length} prompt${userEntries.length !== 1 ? "s" : ""}, 0 files modified)`;
  }

  // Retro-on-retro: session is primarily a retro/check invocation
  if (userEntries.length <= 2) {
    const allContent = transcript.map((e) => e.content).join("\n");
    const isRetroSession = RETRO_PATTERNS.some((p) => p.test(allContent));
    if (isRetroSession) {
      return "session is a retro/check invocation, not a coding session";
    }
  }

  return null;
}

/**
 * Find the next session worth analyzing after skipping one.
 * Scans recent sessions and returns the first that passes shouldSkipSession.
 */
async function findNextViableSession(
  repoPath: string,
  skipId: string,
): Promise<{ id: string; title?: string } | null> {
  // Try native sessions first (most common)
  if (hasNativeTranscripts(repoPath)) {
    const sessions = listNativeSessions(repoPath);
    for (const info of sessions.slice(0, 10)) {
      if (info.sessionId === skipId || info.checkpointId === skipId) continue;
      try {
        const cp = loadNativeSession(repoPath, info.sessionId);
        if (cp && !shouldSkipSession(cp)) {
          return { id: info.sessionId, title: info.title?.slice(0, 50) };
        }
      } catch { /* skip */ }
    }
  }

  // Try Entire.io
  const hasBranch = await hasEntireBranch(repoPath);
  if (hasBranch) {
    const checkpoints = await listCheckpoints(repoPath);
    for (const info of checkpoints.slice(0, 10)) {
      if (info.checkpointId === skipId) continue;
      try {
        const cp = await loadCheckpoint(repoPath, info.checkpointId);
        if (cp && !shouldSkipSession(cp)) {
          return { id: info.checkpointId, title: info.title?.slice(0, 50) };
        }
      } catch { /* skip */ }
    }
  }

  return null;
}

export async function runRetro(options: RetroOptions): Promise<void> {
  const repoPath = options.projectRoot;

  // Batch mode: multiple sessions
  if (options.last || options.today) {
    return runBatchRetro(options);
  }

  // Check if this is an Amp thread
  if (options.checkpointId?.startsWith("T-")) {
    return runAmpRetro(options);
  }

  // Also check if no specific ID given and we should try Amp as a source
  // (Amp threads are only used when explicitly targeted by ID)

  // Try Entire.io first, fall back to native Claude Code transcripts
  const checkpoint = await loadSession(repoPath, options.checkpointId);
  if (!checkpoint) return;

  const skipReason = shouldSkipSession(checkpoint);
  if (skipReason) {
    const id = checkpoint.root.checkpointId.slice(0, 12);
    console.log(chalk.yellow(`Skipping session ${id} — ${skipReason}`));

    // If we auto-selected the latest, suggest the next viable session
    if (!options.checkpointId) {
      const suggestion = await findNextViableSession(repoPath, checkpoint.root.checkpointId);
      if (suggestion) {
        console.log(chalk.gray(`\nTry: sheal retro --checkpoint ${suggestion.id}`) +
          (suggestion.title ? chalk.gray(` (${suggestion.title})`) : ""));
      }
    }
    return;
  }

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
 * Run retro across multiple sessions (--last N or --today).
 */
async function runBatchRetro(options: RetroOptions): Promise<void> {
  const repoPath = options.projectRoot;
  const sessions = listNativeSessions(repoPath);

  if (sessions.length === 0) {
    console.log(chalk.yellow("No sessions found."));
    return;
  }

  let selected = sessions;
  if (options.today) {
    const today = new Date().toISOString().slice(0, 10);
    selected = sessions.filter((s) => s.createdAt.startsWith(today));
    if (selected.length === 0) {
      console.log(chalk.yellow(`No sessions from today (${today}).`));
      return;
    }
  }
  if (options.last) {
    selected = selected.slice(0, options.last);
  }

  if (options.format !== "json") {
    console.log(chalk.bold(`Running retro on ${selected.length} session(s)...\n`));
  }

  const retros: Retrospective[] = [];

  for (const info of selected) {
    const checkpoint = loadNativeSession(repoPath, info.sessionId);
    if (!checkpoint || checkpoint.sessions.length === 0 || checkpoint.sessions[0].transcript.length === 0) {
      if (options.format !== "json") {
        console.log(chalk.gray(`Skipping ${info.sessionId.slice(0, 12)} (no transcript)`));
      }
      continue;
    }

    const skipReason = shouldSkipSession(checkpoint);
    if (skipReason) {
      if (options.format !== "json") {
        console.log(chalk.gray(`Skipping ${info.sessionId.slice(0, 12)} (${skipReason})`));
      }
      continue;
    }

    const retro = runRetrospective(checkpoint);
    retros.push(retro);

    if (options.format === "json") {
      // JSON mode: collect and output at end
    } else {
      // Print each retro with a separator
      console.log(chalk.gray("─".repeat(60)));
      console.log(chalk.bold(`Session: ${info.sessionId.slice(0, 12)}`) + chalk.gray(` ${info.createdAt.slice(0, 16)}`));
      if (info.title) console.log(chalk.gray(`  ${info.title.slice(0, 70)}`));
      console.log();

      const cached = loadCachedEnrichments(repoPath, retro.checkpointId);
      printRetro(retro, cached);
    }
  }

  if (options.format === "json") {
    const clean = retros.map((r) => ({
      ...r,
      failureLoops: r.failureLoops.map(({ entries, ...rest }) => rest),
    }));
    console.log(JSON.stringify(clean, null, 2));
  }

  // Summary
  if (options.format !== "json" && retros.length > 1) {
    console.log(chalk.gray("═".repeat(60)));
    console.log(chalk.bold.magenta(`\nBatch Summary: ${retros.length} sessions\n`));
    const avgHealth = Math.round(retros.reduce((s, r) => s + r.healthScore, 0) / retros.length);
    const totalLoops = retros.reduce((s, r) => s + r.failureLoops.length, 0);
    const totalReverts = retros.reduce((s, r) => s + r.revertedWork.length, 0);
    const totalLearnings = retros.reduce((s, r) => s + r.learnings.length, 0);
    console.log(`  Average health: ${avgHealth}/100`);
    console.log(`  Total failure loops: ${totalLoops}`);
    console.log(`  Total reverted work: ${totalReverts}`);
    console.log(`  Total learnings: ${totalLearnings}`);
    console.log();
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
  // Try native Claude Code transcripts first
  if (hasNativeTranscripts(repoPath)) {
    let sessionId = requestedId;
    if (!sessionId) {
      const sessions = listNativeSessions(repoPath);
      if (sessions.length > 0) {
        sessionId = sessions[0].sessionId;
      }
    }

    if (sessionId) {
      const checkpoint = loadNativeSession(repoPath, sessionId);
      if (checkpoint && checkpoint.sessions.length > 0 && checkpoint.sessions[0].transcript.length > 0) {
        return checkpoint;
      }
    }
  }

  // Try Entire.io
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

  console.log(chalk.yellow("No session data found."));
  console.log(chalk.gray("Supported sources: native Claude Code (~/.claude/projects/), Entire.io, Amp (~/.amp/file-changes/)."));
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
 * Looks for bullet points under a "Rules" section heading.
 * Tolerates various LLM formatting: **Rules:**, ## Rules, ### Rules:, etc.
 */
export function parseRulesFromOutput(output: string): string[] {
  // Match various heading formats for "Rules":
  //   **Rules:**   **Rules**:   ## Rules   ### Rules:   Rules:
  const rulesMatch = output.match(
    /(?:\*{1,2}Rules\*{0,2}\s*:?\s*\*{0,2}|#{1,4}\s*Rules\s*:?)\s*\n([\s\S]*?)(?:\n\*{1,2}[A-Z]|\n#{1,4}\s|$)/,
  );
  if (!rulesMatch) return [];

  const rulesBlock = rulesMatch[1];
  const rules: string[] = [];

  for (const line of rulesBlock.split("\n")) {
    const trimmed = line.trim();
    // Match bullet lines: "- rule text", "* rule text", or "N. rule text"
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+[.)]\s)\s*(.+)/);
    if (bulletMatch) {
      rules.push(bulletMatch[1].trim());
    }
  }

  return rules;
}

/**
 * Ask the user to review each rule and save accepted ones as learnings.
 */
async function promptToSaveRules(rules: string[], projectRoot: string, sessionId?: string): Promise<void> {
  const { reviewDraftLearnings } = await import("../learn/review.js");
  const { getProjectDir } = await import("../learn/store.js");
  const { mkdirSync } = await import("node:fs");

  const projectTags = detectProjectTags(projectRoot);
  const projectDir = getProjectDir(projectRoot);
  mkdirSync(projectDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  // Save all proposed rules as drafts to the project directory
  const drafts: LearningFile[] = [];
  for (const rule of rules) {
    const id = nextId(projectDir);
    const learning: LearningFile = {
      id,
      title: rule.slice(0, 80),
      date: today,
      tags: projectTags.slice(0, 5),
      category: "workflow",
      severity: "medium",
      status: "draft",
      body: rule,
      ...(sessionId ? { sessionId } : {}),
    };
    writeLearning(projectDir, learning);
    drafts.push(learning);
  }

  console.log(chalk.gray(`\nSaved ${drafts.length} draft learning(s) to .sheal/learnings/. Starting review...`));

  // Review drafts — accepted ones get promoted to active, removed ones get deleted
  const result = await reviewDraftLearnings(projectDir);

  if (result.promoted > 0) {
    console.log(chalk.green(`\n${result.promoted} learning(s) accepted. Run 'sheal learn list' to view.`));
    console.log(chalk.gray("Use 'sheal learn promote' to share with other projects."));
  }
  if (result.remaining > 0) {
    console.log(chalk.yellow(`${result.remaining} draft(s) remaining. Run 'sheal learn review' to continue.`));
  }
}

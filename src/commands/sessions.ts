import chalk from "chalk";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";
import {
  hasNativeTranscripts,
  listNativeSessions,
  loadNativeSession,
  listAllNativeProjects,
  listNativeSessionsBySlug,
} from "../entire/claude-native.js";

export interface SessionsOptions {
  format: string;
  projectRoot: string;
  checkpointId?: string;
  global?: boolean;
}

export async function runSessions(options: SessionsOptions): Promise<void> {
  if (options.global) {
    runGlobalSessions(options);
    return;
  }

  const repoPath = options.projectRoot;

  // Try Entire.io first
  const hasBranch = await hasEntireBranch(repoPath);
  if (hasBranch) {
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

    if (checkpoints.length > 0) {
      if (options.format === "json") {
        console.log(JSON.stringify({ source: "entire.io", checkpoints }, null, 2));
      } else {
        printCheckpointList(checkpoints, "Entire.io");
      }
      return;
    }
  }

  // Fall back to native Claude Code transcripts
  if (hasNativeTranscripts(repoPath)) {
    if (options.checkpointId) {
      const checkpoint = loadNativeSession(repoPath, options.checkpointId);
      if (!checkpoint) {
        console.error(chalk.red(`Session ${options.checkpointId} not found`));
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

    const sessions = listNativeSessions(repoPath);
    if (sessions.length > 0) {
      if (options.format === "json") {
        console.log(JSON.stringify({ source: "claude-native", checkpoints: sessions }, null, 2));
      } else {
        printCheckpointList(sessions, "Claude Code (native)");
      }
      return;
    }
  }

  if (options.format === "json") {
    console.log(JSON.stringify({ error: "No session data found" }));
  } else {
    console.log();
    console.log(chalk.yellow("No session data found."));
    console.log(chalk.gray("Supported sources: Entire.io or native Claude Code (~/.claude/projects/)."));
    console.log();
  }
}

/**
 * Global mode: list all projects and their sessions from ~/.claude/projects/
 */
function runGlobalSessions(options: SessionsOptions): void {
  const projects = listAllNativeProjects();

  if (projects.length === 0) {
    if (options.format === "json") {
      console.log(JSON.stringify({ error: "No Claude Code projects found" }));
    } else {
      console.log(chalk.yellow("No Claude Code projects found in ~/.claude/projects/"));
    }
    return;
  }

  if (options.format === "json") {
    const data = projects.map((p) => ({
      ...p,
      sessions: listNativeSessionsBySlug(p.slug).map((s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        title: s.title,
      })),
    }));
    console.log(JSON.stringify({ source: "claude-native-global", projects: data }, null, 2));
    return;
  }

  const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);
  console.log();
  console.log(chalk.bold(`${projects.length} project(s), ${totalSessions} session(s) total`) + chalk.gray(" (Claude Code native)"));
  console.log(chalk.gray("═".repeat(60)));

  for (const project of projects) {
    const lastMod = project.lastModified ? chalk.gray(project.lastModified.slice(0, 16)) : "";
    console.log();
    console.log(`  ${chalk.bold.cyan(project.name)} ${chalk.gray(`(${project.sessionCount} sessions)`)} ${lastMod}`);
    console.log(chalk.gray(`  ${project.projectPath}`));

    // Show the most recent sessions (up to 3)
    const sessions = listNativeSessionsBySlug(project.slug);
    const preview = sessions.slice(0, 3);
    for (const s of preview) {
      const date = s.createdAt ? s.createdAt.slice(0, 16) : "";
      const title = s.title ? `  ${s.title}` : "";
      console.log(chalk.gray(`    ${s.sessionId.slice(0, 12)}  ${date}`) + chalk.white(title));
    }
    if (sessions.length > 3) {
      console.log(chalk.gray(`    ... and ${sessions.length - 3} more`));
    }
  }

  console.log();
  console.log(chalk.gray("Use: sheal sessions -p <project-path> for full session list"));
  console.log(chalk.gray("Use: sheal ask \"question\" --global to search across all projects"));
  console.log();
}

function printCheckpointList(checkpoints: import("../entire/types.js").CheckpointInfo[], source: string): void {
  console.log();
  console.log(chalk.bold(`Found ${checkpoints.length} session(s)`) + chalk.gray(` (${source})`));
  console.log(chalk.gray("─".repeat(50)));
  for (const cp of checkpoints) {
    const agent = cp.agent ? chalk.blue(`[${cp.agent}]`) : "";
    const date = cp.createdAt ? chalk.gray(` ${cp.createdAt.slice(0, 16)}`) : "";
    const files = cp.filesTouched.length > 0
      ? chalk.gray(` (${cp.filesTouched.length} files)`)
      : "";
    const title = cp.title ? chalk.white(` ${cp.title}`) : "";
    console.log(`  ${chalk.cyan(cp.checkpointId.slice(0, 12))}${date} ${agent}${files}${title}`);
  }
  console.log();
  console.log(chalk.gray("Use: sheal sessions --checkpoint <id> for details"));
  console.log();
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

#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runSessions } from "./commands/sessions.js";
import { runRetro } from "./commands/retro.js";
import { runLearnAdd, runLearnList, runLearnSync } from "./commands/learn.js";
import { runAsk } from "./commands/ask.js";
import { runBrowse } from "./commands/browse.js";
import { runInit } from "./commands/init.js";
import { runGraph } from "./commands/graph.js";
import type { LearningCategory, LearningSeverity } from "./learn/types.js";

const program = new Command();

program
  .name("sheal")
  .description("Self-healing AI coding toolkit")
  .version("0.1.0");

program
  .command("check")
  .description("Run pre-session health check on a project")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--skip <checkers>", "Comma-separated checkers to skip (git,dependencies,tests,environment,session-learnings,performance)")
  .action(async (opts) => {
    await runCheck({
      format: opts.format,
      projectRoot: opts.project,
      skip: opts.skip,
    });
  });

program
  .command("sessions")
  .description("List and inspect session data")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("-c, --checkpoint <id>", "Load a specific checkpoint by ID")
  .option("--global", "List all projects and sessions from ~/.claude/projects/", false)
  .action(async (opts) => {
    await runSessions({
      format: opts.format,
      projectRoot: opts.project,
      checkpointId: opts.checkpoint,
      global: opts.global,
    });
  });

program
  .command("retro")
  .description("Run a session retrospective on a completed session")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("-c, --checkpoint <id>", "Checkpoint ID (defaults to latest)")
  .option("--prompt", "Output an LLM prompt for deep analysis (pipe to any agent)")
  .option("--enrich", "Invoke the session's agent CLI for LLM-enriched analysis")
  .option("--agent <name>", "Override agent CLI for --enrich (e.g. claude, gemini, codex)")
  .option("--last <n>", "Run retro on the last N sessions")
  .option("--today", "Run retro on all sessions from today", false)
  .action(async (opts) => {
    await runRetro({
      format: opts.format,
      projectRoot: opts.project,
      checkpointId: opts.checkpoint,
      prompt: opts.prompt,
      enrich: opts.enrich,
      agent: opts.agent,
      last: opts.last ? parseInt(opts.last, 10) : undefined,
      today: opts.today,
    });
  });

program
  .command("ask <question>")
  .description("Ask a question across session transcripts (uses agent CLI for analysis)")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--agent <name>", "Agent CLI to use (e.g. claude, gemini, codex, amp)")
  .option("-n, --limit <count>", "Max sessions to search", "10")
  .option("--global", "Search across ALL projects in ~/.claude/projects/", false)
  .action(async (question: string, opts) => {
    await runAsk({
      question,
      projectRoot: opts.project,
      agent: opts.agent,
      limit: parseInt(opts.limit, 10),
      global: opts.global,
    });
  });

const browse = program
  .command("browse")
  .description("Interactive TUI to browse sessions, retros, and learnings")
  .option("-p, --project <name>", "Pre-filter by project name")
  .option("-q, --query <text>", "Start with a transcript search")
  .option("--agent <name>", "Pre-filter by agent (claude, codex, amp, gemini)")
  .action(async (opts) => {
    await runBrowse({
      project: opts.project,
      query: opts.query,
      agent: opts.agent,
    });
  });

browse
  .command("sessions")
  .description("Browse sessions interactively")
  .option("-p, --project <name>", "Pre-filter by project name")
  .option("--agent <name>", "Pre-filter by agent")
  .action(async (opts) => {
    await runBrowse({
      project: opts.project,
      agent: opts.agent,
    });
  });

browse
  .command("retros")
  .description("Browse retrospectives interactively")
  .option("-p, --project <name>", "Pre-filter by project name")
  .action(async (opts) => {
    await runBrowse({
      project: opts.project,
      startView: "retro-list",
    });
  });

browse
  .command("learnings")
  .description("Browse learnings interactively")
  .option("-p, --project <name>", "Pre-filter by project name")
  .action(async (opts) => {
    await runBrowse({
      project: opts.project,
      startView: "learnings",
    });
  });

program
  .command("init")
  .description("Bootstrap sheal awareness in agent instruction files")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--dry-run", "Show what would be done without making changes", false)
  .action(async (opts) => {
    await runInit({
      projectRoot: opts.project,
      dryRun: opts.dryRun,
    });
  });

program
  .command("graph")
  .description("Show cross-session knowledge graph (files, agents, patterns)")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--file <path>", "Show history for a specific file")
  .option("--agent <name>", "Show details for a specific agent")
  .option("-n, --limit <count>", "Max sessions to analyze", "50")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    runGraph({
      projectRoot: opts.project,
      file: opts.file,
      agent: opts.agent,
      limit: parseInt(opts.limit, 10),
      json: opts.json,
    });
  });

const learn = program
  .command("learn")
  .description("Manage ADR-style session learnings");

learn
  .command("add <insight>")
  .description("Add a new learning to the global store")
  .option("--tags <tags>", "Comma-separated tags", "general")
  .option("--category <cat>", "Category: missing-context, failure-loop, wasted-effort, environment, workflow", "workflow")
  .option("--severity <sev>", "Severity: low, medium, high", "medium")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (insight: string, opts) => {
    await runLearnAdd({
      insight,
      tags: (opts.tags as string).split(",").map((t: string) => t.trim()),
      category: opts.category as LearningCategory,
      severity: opts.severity as LearningSeverity,
      projectRoot: opts.project,
    });
  });

learn
  .command("list")
  .description("List learnings")
  .option("--global", "List from global store instead of project", false)
  .option("--tag <tag>", "Filter by tag")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (opts) => {
    await runLearnList({
      global: opts.global,
      tag: opts.tag,
      projectRoot: opts.project,
    });
  });

learn
  .command("sync")
  .description("Sync relevant global learnings to this project")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (opts) => {
    await runLearnSync({
      projectRoot: opts.project,
    });
  });

program.parse();

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runRetro } from "./commands/retro.js";
import { runLearnAdd, runLearnList, runLearnSync } from "./commands/learn.js";
import { runAsk, runAskList, runAskShow } from "./commands/ask.js";
import { runBrowse } from "./commands/browse.js";
import { runInit } from "./commands/init.js";
import { runExport } from "./commands/export.js";
import { runGraph } from "./commands/graph.js";
import type { LearningCategory, LearningSeverity } from "./learn/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

/** Parse a CLI option as a positive integer, exit with error if invalid. */
function parsePositiveInt(value: string, flag: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) {
    console.error(`Invalid value for ${flag}: "${value}" (must be a positive integer)`);
    process.exit(1);
  }
  return n;
}

const HOWTO = `
Self-Healing AI Coding (sheal) — Quick Guide
=============================================

sheal analyzes your AI coding sessions to extract learnings, detect failure
patterns, and improve agent behavior over time.

Getting Started
───────────────
  sheal check                     Health-check your project setup
  sheal init                      Bootstrap sheal into your agent config files

Retrospectives
──────────────
  sheal retro                     Static retro on your latest session
  sheal retro --enrich            Deep LLM-enriched retro (uses agent CLI)
  sheal retro --agent codex       Use a specific agent for enrichment

Asking Questions
────────────────
  sheal ask "what went wrong with auth?"
                                  Search this project's sessions
  sheal ask --global "recurring test failures"
                                  Search ALL projects
  sheal ask -p /path/to/project "what happened?"
                                  Search a specific project
  sheal ask --agent codex "..."   Use codex/amp/gemini for analysis
  sheal ask-list                  List saved ask results
  sheal ask-show "auth"           Show a saved result

Learnings
─────────
  sheal learn add "Always check real data first" --tags=parsing
                                  Save a learning
  sheal learn list                List project learnings
  sheal learn list --global       List global learnings
  sheal learn sync                Sync global learnings to this project

Browsing
────────
  sheal browse                    Interactive TUI for sessions & retros
  sheal browse sessions           Browse sessions
  sheal browse retros             Browse retrospectives
  sheal browse learnings          Browse learnings
  sheal export                    Export session data as JSON (for piping)
  sheal graph                     Cross-session knowledge graph

Agents
──────
  Supported: claude, codex, amp, gemini
  Auto-detected from PATH. Override with --agent <name>.

Tips
────
  • Run "sheal check" at the start of every session
  • Run "sheal retro" at the end to extract learnings
  • Use "sheal ask --global" to search across all your projects
  • Set SHEAL_DEBUG=1 for verbose output
`;

const program = new Command();

program
  .name("sheal")
  .description("Self-healing AI coding toolkit")
  .version(pkg.version);

program
  .command("howto")
  .description("Show quick-start guide and usage examples")
  .action(() => {
    console.log(HOWTO);
  });

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
  .command("export")
  .description("Export session data as JSON (for scripting and piping)")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("-c, --checkpoint <id>", "Load a specific checkpoint by ID")
  .option("--global", "Export all projects and sessions from ~/.claude/projects/", false)
  .action(async (opts) => {
    await runExport({
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
      last: opts.last ? parsePositiveInt(opts.last, "--last") : undefined,
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
      limit: parsePositiveInt(opts.limit, "--limit"),
      global: opts.global,
    });
  });

program
  .command("ask-list")
  .description("List previously saved ask results")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--global", "List global ask results", false)
  .action(async (opts) => {
    await runAskList({ projectRoot: opts.project, global: opts.global });
  });

program
  .command("ask-show <query>")
  .description("Show a saved ask result by filename or search term")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--global", "Search global ask results", false)
  .action(async (query: string, opts) => {
    await runAskShow({ query, projectRoot: opts.project, global: opts.global });
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
  .action(async (opts) => {
    await runGraph({
      projectRoot: opts.project,
      file: opts.file,
      agent: opts.agent,
      limit: parsePositiveInt(opts.limit, "--limit"),
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

process.on("unhandledRejection", (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

program.parse();

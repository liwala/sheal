#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runRetro } from "./commands/retro.js";
import { runLearnAdd, runLearnList, runLearnShow, runLearnSync, runLearnReview, runLearnPromote, runLearnPrune, runLearnRemoteAdd, runLearnRemoteShow, runLearnRemoteRemove, runLearnPush, runLearnPull } from "./commands/learn.js";
import { runBackupRemoteAdd, runBackupRemoteShow, runBackupRemoteRemove, runBackupPush, runBackupPull } from "./commands/backup.js";
import { runAsk, runAskList, runAskShow } from "./commands/ask.js";
import { runBrowse } from "./commands/browse.js";
import { runAgents } from "./commands/agents.js";
import { runInit } from "./commands/init.js";
import { runDigest } from "./commands/digest.js";
import { runCost } from "./commands/cost.js";
import { runExport } from "./commands/export.js";
import { runGraph } from "./commands/graph.js";
import { runDrift } from "./commands/drift.js";
import { runRules } from "./commands/rules.js";
import { runAudit } from "./commands/audit.js";
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
  sheal audit                     Audit Claude Code settings (permissions, hooks, MCPs)
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

Digest & Cost
─────────────
  sheal digest                    Categorized digest of prompts (last 7 days)
  sheal digest --enrich           LLM-powered categorization
  sheal digest --compare          Diff against previous digest
  sheal cost                      Token cost dashboard
  sheal cost --plan "Max 5x"     Compare against subscription plan
  sheal weekly                    Full weekly report (digest + cost)
  sheal weekly --slack            Post to Slack

Learnings (human-in-the-loop)
─────────────────────────────
  Learnings are never auto-accepted — you review every rule before it
  takes effect. The flow: retro extracts candidate rules as drafts →
  you accept, edit, or reject each one → accepted rules become active.

  sheal learn add "Always check real data first" --tags=parsing
                                  Save a learning (project-local)
  sheal learn add --global "..."  Save directly to global store
  sheal learn list                List project learnings
  sheal learn list --global       List global learnings
  sheal learn show <id>           Show full details of a learning
  sheal learn review              Review & curate project learnings
  sheal learn promote             Promote project learnings to global
  sheal learn sync                Pull global learnings into project
  sheal learn prune               Flag stale learnings (dry-run by default)
  sheal learn prune --apply       Actually remove stale learnings
  sheal rules                     Inject learnings as rules into agent config
  sheal rules --dry-run           Preview without writing

Backup & Sync (git-based)
─────────────────────────
  sheal backup remote add <url>   Connect ~/.sheal/ to a remote git repo
  sheal backup remote show        Show remote configuration
  sheal backup push               Commit + push (learnings, digests, config)
  sheal backup push --include retros  Also aggregate project retros
  sheal backup pull               Pull + merge from remote
  sheal learn push/pull           Aliases for backup push/pull

Browsing
────────
  sheal browse                    Interactive TUI for sessions & retros
  sheal browse sessions           Browse sessions
  sheal browse retros             Browse retrospectives
  sheal browse learnings          Browse learnings
  sheal browse digests            Browse digest reports
  sheal export                    Export session data as JSON (for piping)
  sheal graph                     Cross-session knowledge graph
  sheal drift                     Detect when learnings aren't being applied

Agents
──────
  sheal retro --agent codex         Use codex for enriched retro
  sheal ask --agent gemini "..."    Use gemini for analysis
  sheal browse sessions --agent amp Browse sessions from a specific agent
  sheal graph --agent claude        Graph for a specific agent

  Supported: claude, codex, amp, gemini (auto-detected from PATH)

Tips
────
  • Run "sheal check" at the start of every session
  • Run "sheal retro" at the end to extract learnings
  • Use "sheal learn remote add" to back up learnings to git
  • Use "sheal ask --global" to search across all your projects
  • Set SHEAL_DEBUG=1 for verbose output
`;

const program = new Command();

program
  .name("sheal")
  .description("Self-healing AI coding toolkit")
  .version(pkg.version)
  .action(() => {
    // Bare `sheal` with no command: show the quick guide instead of --help
    console.log(HOWTO);
  });

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
  .command("audit")
  .description("Audit Claude Code settings across all scopes (permissions, hooks, MCPs, env)")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (opts) => {
    await runAudit({
      format: opts.format,
      projectRoot: opts.project,
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

program
  .command("digest")
  .description("Generate a categorized digest of user prompts across all agents")
  .option("--since <window>", "Time window (e.g. '7 days', '1 week', '1 month')", "7 days")
  .option("--until <date>", "End date (defaults to now)")
  .option("-p, --project <name>", "Filter to a specific project name")
  .option("-f, --format <format>", "Output format: pretty | json | markdown", "pretty")
  .option("-o, --output <path>", "Write output to file")
  .option("--top <n>", "Top N items per category", "10")
  .option("--compare", "Compare with previous digest of same scope", false)
  .option("--enrich", "Use Haiku LLM for smart categorization (instead of regex only)", false)
  .action(async (opts) => {
    await runDigest({
      since: opts.since,
      until: opts.until,
      project: opts.project,
      format: opts.format,
      output: opts.output,
      topN: parseInt(opts.top, 10),
      compare: opts.compare,
      enrich: opts.enrich,
    });
  });

program
  .command("cost")
  .description("Token cost dashboard — estimated spend per project and agent")
  .option("--since <window>", "Time window (e.g. '7 days', '1 week', '1 month')", "7 days")
  .option("-p, --project <name>", "Filter to a specific project name")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("--plan <plan>", "Your subscription plan: Pro | Max 5x | Max 20x", "Max 20x")
  .action(async (opts) => {
    await runCost({
      since: opts.since,
      project: opts.project,
      format: opts.format,
      plan: opts.plan,
    });
  });

program
  .command("weekly")
  .description("Run the full weekly digest agent (digest + cost + optional deep analysis)")
  .option("--since <window>", "Time window", "7 days")
  .option("-p, --project <name>", "Filter to a specific project")
  .option("--plan <plan>", "Subscription plan: Pro | Max 5x | Max 20x", "Max 20x")
  .option("--slack", "Send summary to Slack", false)
  .option("--agent", "Run deep analysis with Claude after digest", false)
  .action(async (opts) => {
    const { runWeekly } = await import("./commands/weekly.js");
    await runWeekly({
      since: opts.since,
      project: opts.project,
      plan: opts.plan,
      slack: opts.slack,
      agent: opts.agent,
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
  .command("timeline")
  .description("Browse sessions as a multi-agent stitched timeline")
  .option("-p, --project <name>", "Pre-filter by project name")
  .option("--agent <name>", "Pre-filter by agent")
  .action(async (opts) => {
    await runBrowse({
      project: opts.project,
      agent: opts.agent,
      startView: "timeline",
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

browse
  .command("digests")
  .description("Browse digest reports interactively")
  .action(async () => {
    await runBrowse({
      startView: "digests-list",
    });
  });

program
  .command("agents")
  .description("Analyze how agents are used together across stitched task timelines")
  .option("-p, --project <name>", "Scope to projects matching this name or path")
  .option("--json", "Output as JSON", false)
  .option("--gap <hours>", "Stitching gap in hours (default 2)", "2")
  .option("--top <n>", "Show top N multi-agent tasks (default 10)", "10")
  .action(async (opts) => {
    await runAgents({
      project: opts.project,
      json: opts.json,
      gapHours: parsePositiveInt(opts.gap, "--gap"),
      top: parsePositiveInt(opts.top, "--top"),
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

program
  .command("drift")
  .description("Detect when learnings aren't being applied in recent sessions")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("-n, --last <count>", "Number of recent sessions to analyze", "10")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    await runDrift({
      projectRoot: opts.project,
      last: parsePositiveInt(opts.last, "--last"),
      format: opts.json ? "json" : "text",
    });
  });

program
  .command("rules")
  .description("Inject active learnings as rules into agent config files")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--dry-run", "Show what would be done without making changes", false)
  .action(async (opts) => {
    await runRules({
      projectRoot: opts.project,
      dryRun: opts.dryRun,
    });
  });

const learn = program
  .command("learn")
  .description("Manage ADR-style session learnings");

learn
  .command("add <insight>")
  .description("Add a new learning (project-local by default)")
  .option("--tags <tags>", "Comma-separated tags", "general")
  .option("--category <cat>", "Category: missing-context, failure-loop, wasted-effort, environment, workflow", "workflow")
  .option("--severity <sev>", "Severity: low, medium, high", "medium")
  .option("--global", "Save to global store instead of project", false)
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (insight: string, opts) => {
    await runLearnAdd({
      insight,
      tags: (opts.tags as string).split(",").map((t: string) => t.trim()),
      category: opts.category as LearningCategory,
      severity: opts.severity as LearningSeverity,
      projectRoot: opts.project,
      global: opts.global,
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
  .command("show <id>")
  .description("Show full details of a learning by ID")
  .option("--global", "Search global store only", false)
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (id: string, opts) => {
    await runLearnShow({
      id,
      global: opts.global,
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

learn
  .command("review")
  .description("Interactively review learnings (accept, edit, remove)")
  .option("--global", "Review global learnings instead of project", false)
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (opts) => {
    await runLearnReview({
      global: opts.global,
      projectRoot: opts.project,
    });
  });

learn
  .command("promote")
  .description("Promote project learnings to global store for sharing")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (opts) => {
    await runLearnPromote({
      projectRoot: opts.project,
    });
  });

learn
  .command("prune")
  .description("Flag and remove stale learnings (dead references, old age, retired status)")
  .option("--global", "Prune global learnings instead of project", false)
  .option("--days <n>", "Age threshold in days", "90")
  .option("--apply", "Actually delete stale files (default is dry-run)", false)
  .option("-p, --project <path>", "Project root path", process.cwd())
  .action(async (opts) => {
    await runLearnPrune({
      global: opts.global,
      days: parsePositiveInt(opts.days, "--days"),
      dryRun: !opts.apply,
      projectRoot: opts.project,
    });
  });

learn
  .command("push")
  .description("Commit and push global learnings to remote git repo")
  .action(async () => {
    await runLearnPush();
  });

learn
  .command("pull")
  .description("Pull and merge remote learnings into global store")
  .action(async () => {
    await runLearnPull();
  });

const learnRemote = learn
  .command("remote")
  .description("Manage git remote for global learnings backup");

learnRemote
  .command("add <url>")
  .description("Connect global learnings store to a remote git repo")
  .action(async (url: string) => {
    await runLearnRemoteAdd({ url });
  });

learnRemote
  .command("show")
  .description("Show current remote configuration")
  .action(async () => {
    await runLearnRemoteShow();
  });

learnRemote
  .command("remove")
  .description("Disconnect global learnings from remote")
  .action(async () => {
    await runLearnRemoteRemove();
  });

// ── Backup ──────────────────────────────────────────────────────────

const backup = program
  .command("backup")
  .description("Backup ~/.sheal/ data to a remote git repo (learnings, digests, config, retros)");

backup
  .command("push")
  .description("Commit and push backup (learnings + digests + config)")
  .option("--include <items>", "Additional data: retros")
  .action(async (opts) => {
    const includeRetros = opts.include?.split(",").includes("retros") ?? false;
    await runBackupPush({ includeRetros });
  });

backup
  .command("pull")
  .description("Pull and merge from remote backup")
  .action(async () => {
    await runBackupPull();
  });

const backupRemote = backup
  .command("remote")
  .description("Manage git remote for ~/.sheal/ backup");

backupRemote
  .command("add <url>")
  .description("Connect ~/.sheal/ to a remote git repo")
  .action(async (url: string) => {
    await runBackupRemoteAdd({ url });
  });

backupRemote
  .command("show")
  .description("Show current remote configuration")
  .action(async () => {
    await runBackupRemoteShow();
  });

backupRemote
  .command("remove")
  .description("Disconnect from remote")
  .action(async () => {
    await runBackupRemoteRemove();
  });

process.on("unhandledRejection", (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

program.parse();

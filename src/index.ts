#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runSessions } from "./commands/sessions.js";
import { runRetro } from "./commands/retro.js";
import { runLearnAdd, runLearnList, runLearnSync } from "./commands/learn.js";
import { runAsk } from "./commands/ask.js";
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
  .description("List and inspect Entire.io session data")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("-c, --checkpoint <id>", "Load a specific checkpoint by ID")
  .action(async (opts) => {
    await runSessions({
      format: opts.format,
      projectRoot: opts.project,
      checkpointId: opts.checkpoint,
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
  .action(async (opts) => {
    await runRetro({
      format: opts.format,
      projectRoot: opts.project,
      checkpointId: opts.checkpoint,
      prompt: opts.prompt,
      enrich: opts.enrich,
      agent: opts.agent,
    });
  });

program
  .command("ask <question>")
  .description("Ask a question across all session transcripts (uses agent CLI for analysis)")
  .option("-p, --project <path>", "Project root path", process.cwd())
  .option("--agent <name>", "Agent CLI to use (e.g. claude, gemini, codex)")
  .option("-n, --limit <count>", "Max sessions to search", "10")
  .action(async (question: string, opts) => {
    await runAsk({
      question,
      projectRoot: opts.project,
      agent: opts.agent,
      limit: parseInt(opts.limit, 10),
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

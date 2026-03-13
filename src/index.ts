#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runSessions } from "./commands/sessions.js";
import { runRetro } from "./commands/retro.js";

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
  .option("--skip <checkers>", "Comma-separated checkers to skip (git,dependencies,tests,environment,session-learnings)")
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
  .action(async (opts) => {
    await runRetro({
      format: opts.format,
      projectRoot: opts.project,
      checkpointId: opts.checkpoint,
      prompt: opts.prompt,
    });
  });

program.parse();

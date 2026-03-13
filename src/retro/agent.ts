/**
 * Agent invocation for LLM-enriched retrospectives.
 *
 * Detects the agent that ran the session and invokes it in non-interactive mode
 * to perform deep analysis on top of the static retro results.
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentType } from "../entire/types.js";

const execFileAsync = promisify(execFile);

interface AgentCli {
  /** CLI command name */
  command: string;
  /** Arguments for non-interactive mode (prompt piped via stdin) */
  args: string[];
  /** Whether this CLI reads the prompt from stdin */
  stdinPrompt: boolean;
}

/**
 * Map of supported agent types to their CLI invocation details.
 * All use stdin for the prompt to avoid argument length limits.
 */
const AGENT_CLIS: Record<string, AgentCli> = {
  "Claude Code": {
    command: "claude",
    args: ["-p", "-", "--output-format", "text"],
    stdinPrompt: true,
  },
  "Cursor": {
    command: "claude",
    args: ["-p", "-", "--output-format", "text"],
    stdinPrompt: true,
  },
  "Gemini CLI": {
    command: "gemini",
    args: [],
    stdinPrompt: true,
  },
  "Codex": {
    command: "codex",
    args: ["-q"],
    stdinPrompt: true,
  },
};

/**
 * Map of bare CLI command names to their invocation details.
 * Used when the user passes --agent=claude, --agent=gemini, etc.
 */
const CLI_BY_COMMAND: Record<string, AgentCli> = {
  claude: AGENT_CLIS["Claude Code"],
  gemini: AGENT_CLIS["Gemini CLI"],
  codex: AGENT_CLIS["Codex"],
};

/**
 * Check if a CLI command is available on the system.
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

export interface AgentInvocationResult {
  /** The agent type that was invoked */
  agent: string;
  /** The CLI command used */
  command: string;
  /** Raw output from the agent */
  output: string;
  /** Whether the invocation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Detect the best agent CLI to use for enrichment.
 * Accepts an Entire.io agent type ("Claude Code") or a bare CLI name ("claude").
 * Prefers the given agent, falls back to any available agent.
 */
export async function detectAgentCli(
  sessionAgent?: AgentType,
): Promise<AgentCli | null> {
  if (sessionAgent) {
    const cli = AGENT_CLIS[sessionAgent] ?? CLI_BY_COMMAND[sessionAgent];
    if (cli && await isCommandAvailable(cli.command)) {
      return cli;
    }
  }

  // Fall back to any available agent CLI
  for (const [, cli] of Object.entries(AGENT_CLIS)) {
    if (await isCommandAvailable(cli.command)) {
      return cli;
    }
  }

  return null;
}

/**
 * Invoke an agent CLI with a prompt piped via stdin.
 */
export async function invokeAgent(
  cli: AgentCli,
  prompt: string,
  timeoutMs = 120_000,
): Promise<AgentInvocationResult> {
  const label = `${cli.command} ${cli.args.join(" ")}`;

  return new Promise((resolve) => {
    const child = spawn(cli.command, cli.args, {
      timeout: timeoutMs,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (err) => {
      resolve({
        agent: cli.command,
        command: label,
        output: "",
        success: false,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString().trim();
      const err = Buffer.concat(stderr).toString().trim();

      if (code !== 0) {
        resolve({
          agent: cli.command,
          command: label,
          output: out || err || `Exit code ${code}`,
          success: false,
          error: `Process exited with code ${code}${err ? `: ${err.slice(0, 200)}` : ""}`,
        });
        return;
      }

      if (!out) {
        resolve({
          agent: cli.command,
          command: label,
          output: err || "(empty output)",
          success: false,
          error: "Agent returned empty output",
        });
        return;
      }

      resolve({
        agent: cli.command,
        command: label,
        output: out,
        success: true,
      });
    });

    // Write prompt to stdin and close
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

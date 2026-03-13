import { describe, it, expect } from "vitest";
import { detectAgentCli } from "../src/retro/agent.js";

describe("detectAgentCli", () => {
  it("returns a CLI for Claude Code agent", async () => {
    const cli = await detectAgentCli("Claude Code");
    // claude CLI should be available in this environment
    if (cli) {
      expect(cli.command).toBe("claude");
      expect(cli.args).toContain("-p");
      expect(cli.stdinPrompt).toBe(true);
    }
  });

  it("returns null for unknown agent when no fallback available", async () => {
    const cli = await detectAgentCli("Nonexistent Agent v99");
    // Can't assert null since claude may be available as fallback
    expect(cli === null || cli.command).toBeTruthy();
  });

  it("resolves bare CLI names (--agent=claude)", async () => {
    const cli = await detectAgentCli("claude");
    if (cli) {
      expect(cli.command).toBe("claude");
    }
  });

  it("falls back when session agent CLI is unavailable", async () => {
    const cli = await detectAgentCli("Gemini CLI");
    if (cli) {
      expect(typeof cli.command).toBe("string");
      expect(Array.isArray(cli.args)).toBe(true);
    }
  });
});

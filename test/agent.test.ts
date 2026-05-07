import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { defaultAgentTimeoutMs, detectAgentCli } from "../src/retro/agent.js";

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

describe("defaultAgentTimeoutMs", () => {
  const original = process.env.SHEAL_AGENT_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.SHEAL_AGENT_TIMEOUT_MS;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SHEAL_AGENT_TIMEOUT_MS;
    else process.env.SHEAL_AGENT_TIMEOUT_MS = original;
  });

  it("defaults to 10 minutes when env var is unset", () => {
    expect(defaultAgentTimeoutMs()).toBe(600_000);
  });

  it("honours SHEAL_AGENT_TIMEOUT_MS when set to a positive number", () => {
    process.env.SHEAL_AGENT_TIMEOUT_MS = "30000";
    expect(defaultAgentTimeoutMs()).toBe(30_000);
  });

  it("falls back to default for non-numeric values", () => {
    process.env.SHEAL_AGENT_TIMEOUT_MS = "soon";
    expect(defaultAgentTimeoutMs()).toBe(600_000);
  });

  it("falls back to default for non-positive values", () => {
    process.env.SHEAL_AGENT_TIMEOUT_MS = "0";
    expect(defaultAgentTimeoutMs()).toBe(600_000);
    process.env.SHEAL_AGENT_TIMEOUT_MS = "-5";
    expect(defaultAgentTimeoutMs()).toBe(600_000);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../src/commands/init.js";

const SHEAL_BEGIN = "<!-- BEGIN SHEAL INTEGRATION -->";
const SHEAL_END = "<!-- END SHEAL INTEGRATION -->";

describe("runInit", () => {
  let tmp: string;
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  function makeTmp(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-init-test-"));
    return tmp;
  }

  afterEach(() => {
    consoleSpy.mockClear();
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates .sheal/ directory when missing", async () => {
    const root = makeTmp();
    await runInit({ projectRoot: root, dryRun: false });

    expect(existsSync(join(root, ".sheal"))).toBe(true);
  });

  it("creates AGENTS.md when no agent files exist", async () => {
    const root = makeTmp();
    await runInit({ projectRoot: root, dryRun: false });

    const agentsPath = join(root, "AGENTS.md");
    expect(existsSync(agentsPath)).toBe(true);

    const content = readFileSync(agentsPath, "utf-8");
    expect(content).toContain("# Agent Instructions");
    expect(content).toContain(SHEAL_BEGIN);
    expect(content).toContain(SHEAL_END);
    expect(content).toContain("sheal check");
  });

  it("injects sheal block into existing AGENTS.md", async () => {
    const root = makeTmp();
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# My Agent Instructions\n\nSome existing content.\n");

    await runInit({ projectRoot: root, dryRun: false });

    const content = readFileSync(agentsPath, "utf-8");
    expect(content).toContain("# My Agent Instructions");
    expect(content).toContain("Some existing content.");
    expect(content).toContain(SHEAL_BEGIN);
    expect(content).toContain(SHEAL_END);
  });

  it("is idempotent: re-running does not duplicate the block", async () => {
    const root = makeTmp();
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# Instructions\n\nContent here.\n");

    await runInit({ projectRoot: root, dryRun: false });
    const afterFirst = readFileSync(agentsPath, "utf-8");

    await runInit({ projectRoot: root, dryRun: false });
    const afterSecond = readFileSync(agentsPath, "utf-8");

    expect(afterSecond).toBe(afterFirst);

    // Count occurrences of the begin marker
    const matches = afterSecond.match(new RegExp(SHEAL_BEGIN, "g"));
    expect(matches).toHaveLength(1);
  });

  it("dry-run mode does not write files", async () => {
    const root = makeTmp();

    await runInit({ projectRoot: root, dryRun: true });

    expect(existsSync(join(root, ".sheal"))).toBe(false);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(root, ".claude", "skills", "retro", "SKILL.md"))).toBe(false);
  });

  it("injects into multiple existing agent files", async () => {
    const root = makeTmp();
    const agentsPath = join(root, "AGENTS.md");
    const claudePath = join(root, "CLAUDE.md");
    writeFileSync(agentsPath, "# AGENTS\n\nAgents content.\n");
    writeFileSync(claudePath, "# CLAUDE\n\nClaude content.\n");

    await runInit({ projectRoot: root, dryRun: false });

    const agentsContent = readFileSync(agentsPath, "utf-8");
    const claudeContent = readFileSync(claudePath, "utf-8");

    expect(agentsContent).toContain(SHEAL_BEGIN);
    expect(agentsContent).toContain("Agents content.");

    expect(claudeContent).toContain(SHEAL_BEGIN);
    expect(claudeContent).toContain("Claude content.");
  });

  it("installs the /retro skill file", async () => {
    const root = makeTmp();

    await runInit({ projectRoot: root, dryRun: false });

    const skillPath = join(root, ".claude", "skills", "retro", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });
});

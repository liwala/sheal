import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { Checkpoint, SessionEntry } from "@liwala/agent-sessions";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");
import { runRetrospective } from "../src/retro/engine.js";
import { assessCompleteness } from "../src/retro/completeness.js";
import { loadCheckpointForRetro, printRetro } from "../src/commands/retro.js";

describe("retro checkpoint completeness", () => {
  it("names every detected input gap and marks the report degraded", () => {
    const checkpoint = makeCheckpoint([
      entry("user", "first request"),
      entry("user", "second request"),
      entry("user", ""),
      entry("tool", "tool result without a recorded call", { toolOutput: "done" }),
    ]);

    const gaps = assessCompleteness(checkpoint);
    const report = runRetrospective(checkpoint);

    expect(gaps).toEqual([
      "No assistant messages were captured.",
      "Transcript contains an entry with missing content.",
      "Transcript contains a tool result without a recorded tool call.",
    ]);
    expect(report.inputGaps).toEqual(gaps);
  });

  it("reports a tool call whose result was never recorded (truncation)", () => {
    const checkpoint = makeCheckpoint([
      entry("user", "one"),
      entry("assistant", "working"),
      entry("tool", "Tool: Read", { toolName: "Read" }),
    ]);

    expect(assessCompleteness(checkpoint)).toContain(
      "Transcript contains a tool call without a recorded result.",
    );
  });

  it("does not flag blank content on tool entries that carry tool data (Gemini shape)", () => {
    const checkpoint = makeCheckpoint([
      entry("user", "one"),
      entry("assistant", "working"),
      entry("tool", "", { toolName: "run_shell", toolOutput: "ok" }),
      entry("assistant", "done"),
    ]);

    expect(assessCompleteness(checkpoint)).not.toContain(
      "Transcript contains an entry with missing content.",
    );
  });

  it("does not flag missing filesTouched for a read-only session", () => {
    const checkpoint = makeCheckpoint([
      entry("user", "look at this"),
      entry("assistant", "reading"),
      entry("tool", "Tool: Read", { toolName: "Read", filesAffected: ["src/app.ts"] }),
      entry("tool", "contents", { toolOutput: "contents" }),
      entry("assistant", "here is what it says"),
    ]);

    expect(assessCompleteness(checkpoint)).toEqual([]);
  });

  it("flags missing filesTouched when file-modifying tools ran", () => {
    const checkpoint = makeCheckpoint([
      entry("user", "change it"),
      entry("assistant", "editing"),
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      entry("tool", "ok", { toolOutput: "ok" }),
      entry("assistant", "done"),
    ]);

    expect(assessCompleteness(checkpoint)).toEqual([
      "No filesTouched data was captured despite file-modifying tool activity.",
    ]);
  });

  it("reports no gaps for a complete checkpoint", () => {
    const checkpoint = makeCheckpoint(
      [
        entry("user", "update app.ts"),
        entry("assistant", "I will inspect it"),
        entry("tool", "Tool: Read", { toolName: "Read", filesAffected: ["src/app.ts"] }),
        entry("tool", "file contents", { toolOutput: "file contents" }),
        entry("assistant", "Done"),
      ],
      ["src/app.ts"],
    );

    const report = runRetrospective(checkpoint);
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      lines.push(values.join(" "));
    });

    try {
      printRetro(report);
    } finally {
      log.mockRestore();
    }

    expect(assessCompleteness(checkpoint)).toEqual([]);
    expect(report.inputGaps).toBeUndefined();
    expect(lines.join("\n")).not.toContain("Analysis Degraded");
  });

  it("includes inputGaps in JSON reports", () => {
    const report = runRetrospective(makeCheckpoint([
      entry("user", "one"),
      entry("user", "two"),
      entry("user", "three"),
    ]));

    expect(JSON.parse(JSON.stringify(report)).inputGaps).toContain(
      "No assistant messages were captured.",
    );
  });

  it("prints an explicit degraded input-gaps section in pretty output", () => {
    const report = runRetrospective(makeCheckpoint([
      entry("user", "one"),
      entry("user", "two"),
      entry("user", "three"),
    ]));
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      lines.push(values.join(" "));
    });

    try {
      printRetro(report);
    } finally {
      log.mockRestore();
    }

    const output = lines.join("\n");
    expect(output).toContain("Input Gaps — Analysis Degraded");
    expect(output).toContain("No assistant messages were captured.");
  });
});

describe("retro checkpoint loading", () => {
  it("returns a clean named error for corrupt JSON without throwing", async () => {
    const result = await loadCheckpointForRetro("broken-checkpoint.json", async () =>
      JSON.parse("not json") as Checkpoint,
    );

    expect(result).toEqual({
      error: expect.stringContaining("broken-checkpoint.json"),
    });
    expect(result.error).toContain("invalid JSON");
    expect(result.error).not.toContain("at JSON.parse");
  });

  it("returns a clean named error for a checkpoint missing required structure", async () => {
    const result = await loadCheckpointForRetro("missing-root", async () =>
      ({ sessions: [] }) as unknown as Checkpoint,
    );

    expect(result).toEqual({
      error: expect.stringContaining("missing-root"),
    });
    expect(result.error).toContain("missing required structure");
  });

  it("does not change the process exit code for input gaps", () => {
    const originalExitCode = process.exitCode;
    const checkpoint = makeCheckpoint([
      entry("user", "one"),
      entry("user", "two"),
      entry("user", "three"),
    ]);

    try {
      runRetrospective(checkpoint);
      expect(process.exitCode).toBe(originalExitCode);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});

describe("sheal retro (CLI, truncated and corrupt fixtures)", () => {
  function plantSession(home: string, projectRoot: string, sessionId: string, lines: string[]): void {
    const slug = projectRoot.replace(/[\\/: ]/g, "-");
    const dir = join(home, ".claude", "projects", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n", "utf-8");
  }

  function userLine(projectRoot: string, sessionId: string, n: number): string {
    return JSON.stringify({
      type: "user",
      uuid: `u${n}`,
      timestamp: `2026-07-17T10:0${n}:00.000Z`,
      sessionId,
      cwd: projectRoot,
      message: { role: "user", content: [{ type: "text", text: `prompt ${n}` }] },
    });
  }

  function runRetroCli(home: string, projectRoot: string, args: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "retro", "-p", projectRoot, ...args],
      { encoding: "utf-8", env: { ...process.env, HOME: home } },
    );
  }

  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeEnv(): { home: string; projectRoot: string } {
    tmp = mkdtempSync(join(tmpdir(), "sheal-retro-cli-"));
    const home = join(tmp, "home");
    const projectRoot = join(tmp, "project");
    mkdirSync(home, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: projectRoot });
    return { home, projectRoot };
  }

  it("reports input gaps for a truncated session and exits 0", () => {
    const { home, projectRoot } = makeEnv();
    const sessionId = "truncated-session";
    plantSession(home, projectRoot, sessionId, [
      userLine(projectRoot, sessionId, 1),
      userLine(projectRoot, sessionId, 2),
      userLine(projectRoot, sessionId, 3),
    ]);

    const result = runRetroCli(home, projectRoot, ["-c", sessionId]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Input Gaps");
    expect(result.stdout).toContain("No assistant messages were captured.");

    const json = runRetroCli(home, projectRoot, ["-c", sessionId, "-f", "json"]);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout).inputGaps).toContain("No assistant messages were captured.");
  });

  it("handles a corrupt session file without a stack trace", () => {
    const { home, projectRoot } = makeEnv();
    const sessionId = "corrupt-session";
    plantSession(home, projectRoot, sessionId, ["this is not json {{{", "nor is this"]);

    const result = runRetroCli(home, projectRoot, ["-c", sessionId]);
    expect(result.status).toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/^\s+at .+\(.+:\d+:\d+\)$/m);
    expect(combined.trim().length).toBeGreaterThan(0);
  });
});

function makeCheckpoint(transcript: SessionEntry[], filesTouched: string[] = []): Checkpoint {
  return {
    root: {
      checkpointId: "checkpoint-22",
      strategy: "native",
      checkpointsCount: 1,
      filesTouched,
      sessions: [],
    },
    sessions: [{
      metadata: {
        checkpointId: "checkpoint-22",
        sessionId: "session-22",
        strategy: "native",
        createdAt: "2026-07-17T10:00:00.000Z",
        checkpointsCount: 1,
        filesTouched,
        agent: "Codex",
      },
      transcript,
      prompts: transcript.filter((item) => item.type === "user").map((item) => item.content),
    }],
  };
}

function entry(
  type: SessionEntry["type"],
  content: string,
  extra: Partial<SessionEntry> = {},
): SessionEntry {
  return {
    uuid: `${type}-${content}`,
    type,
    content,
    ...extra,
  };
}

import { describe, expect, it, vi } from "vitest";
import type { Checkpoint, SessionEntry } from "@liwala/agent-sessions";
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
      "No filesTouched data was captured.",
    ]);
    expect(report.inputGaps).toEqual(gaps);
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

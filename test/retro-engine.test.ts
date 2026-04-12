import { describe, it, expect } from "vitest";
import { runRetrospective } from "../src/retro/engine.js";
import type { Checkpoint, Session, SessionEntry } from "../src/entire/types.js";
import type { Retrospective } from "../src/retro/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeCheckpoint(transcript: SessionEntry[], overrides?: Partial<Session["metadata"]>): Checkpoint {
  const session: Session = {
    metadata: {
      checkpointId: "cp-001",
      sessionId: "s-001",
      strategy: "test",
      createdAt: "2026-03-20T10:00:00Z",
      checkpointsCount: 1,
      filesTouched: [],
      agent: "Claude Code",
      ...overrides,
    },
    transcript,
    prompts: transcript.filter((e) => e.type === "user").map((e) => e.content),
  };

  return {
    root: {
      checkpointId: overrides?.checkpointId ?? "cp-001",
      strategy: "test",
      checkpointsCount: 1,
      filesTouched: [],
      sessions: [],
    },
    sessions: [session],
  };
}

function entry(type: SessionEntry["type"], content: string, extra?: Partial<SessionEntry>): SessionEntry {
  return {
    uuid: `${type[0]}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    ...extra,
  };
}

// ── Integration tests ────────────────────────────────────────────────

describe("runRetrospective", () => {
  it("produces a valid Retrospective with all required fields", () => {
    const cp = makeCheckpoint([
      entry("user", "fix the bug in app.ts"),
      entry("assistant", "I'll look at app.ts"),
      entry("tool", "Tool: Read", { toolName: "Read", filesAffected: ["src/app.ts"] }),
      entry("tool", "content of file", { toolOutput: "content of file" }),
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      entry("tool", "OK", { toolOutput: "OK" }),
      entry("assistant", "Fixed the bug."),
      entry("user", "thanks"),
    ]);

    const retro = runRetrospective(cp);

    // Structure checks
    expect(retro.checkpointId).toBe("cp-001");
    expect(retro.sessionId).toBe("s-001");
    expect(retro.agent).toBe("Claude Code");
    expect(retro.createdAt).toBe("2026-03-20T10:00:00Z");

    // Effort
    expect(retro.effort.userPromptCount).toBe(2);
    expect(retro.effort.assistantResponseCount).toBe(2);
    expect(retro.effort.toolCounts["Read"]).toBe(1);
    expect(retro.effort.toolCounts["Edit"]).toBe(1);

    // Clean session should score well
    expect(retro.healthScore).toBeGreaterThanOrEqual(90);
    expect(retro.failureLoops).toHaveLength(0);
    expect(retro.revertedWork).toHaveLength(0);

    // Human patterns present
    expect(retro.humanPatterns).toBeDefined();
    expect(retro.humanPatterns!.correctionCount).toBe(0);
  });

  it("detects problems in a messy session", () => {
    const transcript: SessionEntry[] = [
      entry("user", "make it work"),
      // Failure loop: 4 retries of same bash command with errors
      entry("tool", "Tool: Bash", { toolName: "Bash", toolInput: { command: "npm test" } }),
      entry("tool", "Exit code 1\nError: test failed", { toolOutput: "Exit code 1\nError: test failed" }),
      entry("tool", "Tool: Bash", { toolName: "Bash", toolInput: { command: "npm test" } }),
      entry("tool", "Exit code 1\nError: test failed", { toolOutput: "Exit code 1\nError: test failed" }),
      entry("tool", "Tool: Bash", { toolName: "Bash", toolInput: { command: "npm test" } }),
      entry("tool", "Exit code 1\nError: test failed", { toolOutput: "Exit code 1\nError: test failed" }),
      entry("tool", "Tool: Bash", { toolName: "Bash", toolInput: { command: "npm test" } }),
      entry("tool", "Exit code 1\nError: test failed", { toolOutput: "Exit code 1\nError: test failed" }),
      // File churn: 5 edits on same file
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      entry("tool", "Tool: Edit", { toolName: "Edit", filesAffected: ["src/app.ts"] }),
      // Corrections
      entry("user", "no, that's wrong — revert it"),
      entry("assistant", "reverting"),
    ];

    const cp = makeCheckpoint(transcript);
    const retro = runRetrospective(cp);

    expect(retro.healthScore).toBeLessThan(90);
    expect(retro.failureLoops.length).toBeGreaterThan(0);
    expect(retro.revertedWork.length).toBeGreaterThan(0);
    expect(retro.learnings.length).toBeGreaterThan(0);
    expect(retro.humanPatterns!.correctionCount).toBeGreaterThan(0);
  });

  it("throws for invalid session index", () => {
    const cp = makeCheckpoint([entry("user", "hello")]);
    expect(() => runRetrospective(cp, 5)).toThrow("Session index 5 not found");
  });

  it("includes coordination issues for multi-session checkpoints", () => {
    const session1: Session = {
      metadata: {
        checkpointId: "cp-multi",
        sessionId: "s1",
        strategy: "test",
        createdAt: "2026-03-20",
        checkpointsCount: 1,
        filesTouched: ["src/shared.ts"],
        agent: "Claude Code",
      },
      transcript: [
        entry("tool", "Tool: Write", { toolName: "Write", filesAffected: ["src/shared.ts"] }),
      ],
      prompts: [],
    };

    const session2: Session = {
      metadata: {
        checkpointId: "cp-multi",
        sessionId: "s2",
        strategy: "test",
        createdAt: "2026-03-20",
        checkpointsCount: 1,
        filesTouched: ["src/shared.ts"],
        agent: "Gemini CLI",
      },
      transcript: [
        entry("tool", "Tool: Write", { toolName: "Write", filesAffected: ["src/shared.ts"] }),
      ],
      prompts: [],
    };

    const cp: Checkpoint = {
      root: {
        checkpointId: "cp-multi",
        strategy: "test",
        checkpointsCount: 1,
        filesTouched: [],
        sessions: [],
      },
      sessions: [session1, session2],
    };

    const retro = runRetrospective(cp);
    expect(retro.coordinationIssues).toBeDefined();
    expect(retro.coordinationIssues!.length).toBeGreaterThan(0);
    expect(retro.coordinationIssues![0].type).toBe("conflicting-edits");
  });

  it("handles empty transcript gracefully", () => {
    const cp = makeCheckpoint([]);
    const retro = runRetrospective(cp);

    expect(retro.healthScore).toBe(100);
    expect(retro.failureLoops).toHaveLength(0);
    expect(retro.revertedWork).toHaveLength(0);
    expect(retro.learnings).toHaveLength(0);
    expect(retro.effort.userPromptCount).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  analyzeEffort,
  detectFailureLoops,
  detectRevertedWork,
  detectBashFailures,
  extractLearnings,
  analyzeHumanPatterns,
  calculateHealthScore,
} from "../src/retro/analyzers.js";
import type { Session, SessionEntry } from "@liwala/agent-sessions";

// ── Helpers ──────────────────────────────────────────────────────────

function makeSession(transcript: SessionEntry[], overrides?: Partial<Session["metadata"]>): Session {
  return {
    metadata: {
      checkpointId: "cp-test",
      sessionId: "s-test",
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
}

function userEntry(content: string): SessionEntry {
  return { uuid: `u-${Math.random().toString(36).slice(2, 8)}`, type: "user", content };
}

function assistantEntry(content: string): SessionEntry {
  return { uuid: `a-${Math.random().toString(36).slice(2, 8)}`, type: "assistant", content };
}

function toolEntry(toolName: string, filesAffected?: string[], toolInput?: unknown): SessionEntry {
  return {
    uuid: `t-${Math.random().toString(36).slice(2, 8)}`,
    type: "tool",
    content: `Tool: ${toolName}`,
    toolName,
    toolInput,
    filesAffected,
  };
}

function toolOutputEntry(output: string): SessionEntry {
  return {
    uuid: `to-${Math.random().toString(36).slice(2, 8)}`,
    type: "tool",
    content: output,
    toolOutput: output,
  };
}

function systemEntry(content: string): SessionEntry {
  return { uuid: `sys-${Math.random().toString(36).slice(2, 8)}`, type: "system", content };
}

// ── analyzeEffort ────────────────────────────────────────────────────

describe("analyzeEffort", () => {
  it("counts entry types correctly", () => {
    const session = makeSession([
      userEntry("fix the bug"),
      assistantEntry("I'll fix it"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("ok"),
      userEntry("thanks"),
    ]);

    const effort = analyzeEffort(session);
    expect(effort.userPromptCount).toBe(2);
    expect(effort.assistantResponseCount).toBe(1);
    expect(effort.entryCounts["user"]).toBe(2);
    expect(effort.entryCounts["assistant"]).toBe(1);
    expect(effort.entryCounts["tool"]).toBe(2);
  });

  it("counts tool usage", () => {
    const session = makeSession([
      toolEntry("Read", ["src/a.ts"]),
      toolEntry("Read", ["src/b.ts"]),
      toolEntry("Edit", ["src/a.ts"]),
      toolEntry("Bash", [], { command: "npm test" }),
    ]);

    const effort = analyzeEffort(session);
    expect(effort.toolCounts["Read"]).toBe(2);
    expect(effort.toolCounts["Edit"]).toBe(1);
    expect(effort.toolCounts["Bash"]).toBe(1);
  });

  it("counts file touches", () => {
    const session = makeSession([
      toolEntry("Edit", ["src/app.ts"]),
      toolEntry("Edit", ["src/app.ts"]),
      toolEntry("Write", ["src/new.ts"]),
    ]);

    const effort = analyzeEffort(session);
    expect(effort.fileTouchCounts["src/app.ts"]).toBe(2);
    expect(effort.fileTouchCounts["src/new.ts"]).toBe(1);
    expect(Object.keys(effort.fileTouchCounts)).toHaveLength(2);
  });

  it("handles empty transcript", () => {
    const session = makeSession([]);
    const effort = analyzeEffort(session);
    expect(effort.userPromptCount).toBe(0);
    expect(effort.assistantResponseCount).toBe(0);
    expect(Object.keys(effort.toolCounts)).toHaveLength(0);
  });

  it("includes token usage from metadata", () => {
    const session = makeSession([], {
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        apiCallCount: 5,
      },
    });

    const effort = analyzeEffort(session);
    expect(effort.tokenUsage?.inputTokens).toBe(1000);
    expect(effort.tokenUsage?.apiCallCount).toBe(5);
  });
});

// ── detectFailureLoops ───────────────────────────────────────────────

describe("detectFailureLoops", () => {
  it("detects 3+ consecutive retries of the same tool+file with errors", () => {
    const session = makeSession([
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: syntax error"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: syntax error"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: syntax error"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops).toHaveLength(1);
    expect(loops[0].retryCount).toBe(3);
    expect(loops[0].action).toContain("Edit");
    expect(loops[0].action).toContain("app.ts");
  });

  it("does not flag productive repeated edits (no errors)", () => {
    const session = makeSession([
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("OK"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("OK"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("OK"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops).toHaveLength(0);
  });

  it("does not flag fewer than 3 retries", () => {
    const session = makeSession([
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: syntax error"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: syntax error"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops).toHaveLength(0);
  });

  it("groups Bash commands by normalized command", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops).toHaveLength(1);
    expect(loops[0].action).toContain("npm test");
  });

  it("does not group different Bash commands together", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npm run build" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npx tsc" }),
      toolOutputEntry("Exit code 1"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops).toHaveLength(0);
  });

  it("detects multiple distinct failure loops", () => {
    const session = makeSession([
      // Loop 1: Edit on app.ts
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: type mismatch"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: type mismatch"),
      toolEntry("Edit", ["src/app.ts"]),
      toolOutputEntry("Error: type mismatch"),
      // Different tool breaks the run
      toolEntry("Read", ["src/types.ts"]),
      // Loop 2: npm test
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops).toHaveLength(2);
  });

  it("captures error pattern from output", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1\nTypeError: cannot read property 'foo' of undefined"),
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1\nTypeError: cannot read property 'foo' of undefined"),
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1\nTypeError: cannot read property 'foo' of undefined"),
    ]);

    const loops = detectFailureLoops(session);
    expect(loops[0].errorPattern).toContain("Exit code 1");
  });
});

// ── detectRevertedWork ───────────────────────────────────────────────

describe("detectRevertedWork", () => {
  it("flags files written 4+ times as churned", () => {
    const session = makeSession([
      toolEntry("Write", ["src/app.ts"]),
      toolEntry("Edit", ["src/app.ts"]),
      toolEntry("Edit", ["src/app.ts"]),
      toolEntry("Edit", ["src/app.ts"]),
    ]);

    const reverted = detectRevertedWork(session);
    expect(reverted).toHaveLength(1);
    expect(reverted[0].files).toContain("src/app.ts");
    expect(reverted[0].wastedOperations).toBe(3); // 4 writes - 1 = 3 wasted
  });

  it("does not flag files written fewer than 4 times", () => {
    const session = makeSession([
      toolEntry("Write", ["src/app.ts"]),
      toolEntry("Edit", ["src/app.ts"]),
      toolEntry("Edit", ["src/app.ts"]),
    ]);

    const reverted = detectRevertedWork(session);
    expect(reverted).toHaveLength(0);
  });

  it("groups multiple churned files into one RevertedWork", () => {
    const session = makeSession([
      toolEntry("Write", ["src/a.ts"]),
      toolEntry("Edit", ["src/a.ts"]),
      toolEntry("Edit", ["src/a.ts"]),
      toolEntry("Edit", ["src/a.ts"]),
      toolEntry("Write", ["src/b.ts"]),
      toolEntry("Edit", ["src/b.ts"]),
      toolEntry("Edit", ["src/b.ts"]),
      toolEntry("Edit", ["src/b.ts"]),
      toolEntry("Edit", ["src/b.ts"]),
    ]);

    const reverted = detectRevertedWork(session);
    expect(reverted).toHaveLength(1);
    expect(reverted[0].files).toContain("src/a.ts");
    expect(reverted[0].files).toContain("src/b.ts");
    // a: 4 writes - 1 = 3, b: 5 writes - 1 = 4 => total 7
    expect(reverted[0].wastedOperations).toBe(7);
  });

  it("only counts Write and Edit tools", () => {
    const session = makeSession([
      toolEntry("Read", ["src/app.ts"]),
      toolEntry("Read", ["src/app.ts"]),
      toolEntry("Read", ["src/app.ts"]),
      toolEntry("Read", ["src/app.ts"]),
      toolEntry("Read", ["src/app.ts"]),
    ]);

    const reverted = detectRevertedWork(session);
    expect(reverted).toHaveLength(0);
  });

  it("handles empty transcript", () => {
    const session = makeSession([]);
    expect(detectRevertedWork(session)).toEqual([]);
  });
});

// ── detectBashFailures ───────────────────────────────────────────────

describe("detectBashFailures", () => {
  it("detects Bash commands followed by error output", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1\nTest failed"),
    ]);

    const failures = detectBashFailures(session);
    expect(failures).toHaveLength(1);
    expect(failures[0].command).toContain("npm test");
    expect(failures[0].error).toContain("Exit code 1");
  });

  it("does not flag successful Bash commands", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("All tests passed"),
    ]);

    const failures = detectBashFailures(session);
    expect(failures).toHaveLength(0);
  });

  it("looks ahead up to 2 entries for error output", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      assistantEntry("Let me check..."),
      toolOutputEntry("Error: compilation failed"),
    ]);

    const failures = detectBashFailures(session);
    expect(failures).toHaveLength(1);
  });

  it("handles multiple failures", () => {
    const session = makeSession([
      toolEntry("Bash", [], { command: "npm test" }),
      toolOutputEntry("Exit code 1"),
      toolEntry("Bash", [], { command: "npm run build" }),
      toolOutputEntry("error: TS2345"),
    ]);

    const failures = detectBashFailures(session);
    expect(failures).toHaveLength(2);
  });

  it("handles empty transcript", () => {
    const session = makeSession([]);
    expect(detectBashFailures(session)).toEqual([]);
  });
});

// ── extractLearnings ─────────────────────────────────────────────────

describe("extractLearnings", () => {
  it("generates learning from failure loops", () => {
    const effort = analyzeEffort(makeSession([]));
    const loops = [{ action: "Edit on app.ts", retryCount: 5, entries: [], errorPattern: "syntax error" }];
    const learnings = extractLearnings(effort, loops, [], []);

    expect(learnings.length).toBeGreaterThanOrEqual(1);
    const loopLearning = learnings.find((l) => l.category === "failure-loop");
    expect(loopLearning).toBeDefined();
    expect(loopLearning!.severity).toBe("high"); // 5 retries >= 5 threshold
    expect(loopLearning!.description).toContain("5 times");
  });

  it("rates failure loop severity medium for < 5 retries", () => {
    const effort = analyzeEffort(makeSession([]));
    const loops = [{ action: "Edit on app.ts", retryCount: 3, entries: [], errorPattern: "err" }];
    const learnings = extractLearnings(effort, loops, [], []);
    const loopLearning = learnings.find((l) => l.category === "failure-loop");
    expect(loopLearning!.severity).toBe("medium");
  });

  it("generates learning from reverted work", () => {
    const effort = analyzeEffort(makeSession([]));
    const reverted = [{ files: ["src/app.ts", "src/utils.ts"], wastedOperations: 8 }];
    const learnings = extractLearnings(effort, [], reverted, []);

    const revertLearning = learnings.find((l) => l.category === "wasted-effort");
    expect(revertLearning).toBeDefined();
    expect(revertLearning!.severity).toBe("high"); // 8 >= 6 threshold
  });

  it("generates learning from bash failures when >= 3", () => {
    const effort = analyzeEffort(makeSession([]));
    const bashFailures = [
      { command: "npm test", error: "fail" },
      { command: "npm test", error: "fail" },
      { command: "npm test", error: "fail" },
    ];
    const learnings = extractLearnings(effort, [], [], bashFailures);

    const envLearning = learnings.find((l) => l.category === "environment");
    expect(envLearning).toBeDefined();
  });

  it("does not generate bash learning for < 3 failures", () => {
    const effort = analyzeEffort(makeSession([]));
    const bashFailures = [
      { command: "npm test", error: "fail" },
      { command: "npm test", error: "fail" },
    ];
    const learnings = extractLearnings(effort, [], [], bashFailures);
    expect(learnings.find((l) => l.category === "environment")).toBeUndefined();
  });

  it("generates hot file learning when file touched 5+ times", () => {
    const session = makeSession([
      toolEntry("Edit", ["src/hot.ts"]),
      toolEntry("Edit", ["src/hot.ts"]),
      toolEntry("Edit", ["src/hot.ts"]),
      toolEntry("Edit", ["src/hot.ts"]),
      toolEntry("Edit", ["src/hot.ts"]),
    ]);
    const effort = analyzeEffort(session);
    const learnings = extractLearnings(effort, [], [], []);

    const hotLearning = learnings.find((l) => l.description.includes("Hot files"));
    expect(hotLearning).toBeDefined();
    expect(hotLearning!.description).toContain("hot.ts");
  });

  it("returns empty array for a clean session", () => {
    const session = makeSession([
      userEntry("fix bug"),
      assistantEntry("done"),
      toolEntry("Edit", ["src/app.ts"]),
    ]);
    const effort = analyzeEffort(session);
    const learnings = extractLearnings(effort, [], [], []);
    expect(learnings).toEqual([]);
  });
});

// ── analyzeHumanPatterns ─────────────────────────────────────────────

describe("analyzeHumanPatterns", () => {
  it("counts corrections", () => {
    const session = makeSession([
      userEntry("add a feature"),
      assistantEntry("here you go"),
      userEntry("no, not that — do it differently"),
      assistantEntry("ok, here's a different approach"),
      userEntry("actually, revert that"),
      assistantEntry("reverted"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.correctionCount).toBe(2); // "no, not that" + "actually,"
  });

  it("counts short prompts", () => {
    const session = makeSession([
      userEntry("y"),
      userEntry("ok"),
      userEntry("yes"),
      userEntry("continue"),
      userEntry("This is a longer prompt asking for real work"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.shortPromptCount).toBe(4); // all < 20 chars
  });

  it("counts long prompts", () => {
    const session = makeSession([
      userEntry("x".repeat(600)),
      userEntry("y".repeat(501)),
      userEntry("short"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.longPromptCount).toBe(2);
  });

  it("detects context compaction", () => {
    const session = makeSession([
      userEntry("do something"),
      systemEntry("Context has been compressed due to context limit"),
      userEntry("continue"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.contextCompacted).toBe(true);
  });

  it("detects context compaction from user message continuation marker", () => {
    const session = makeSession([
      userEntry("This conversation is being continued from a previous conversation."),
      assistantEntry("understood"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.contextCompacted).toBe(true);
  });

  it("reports no compaction when absent", () => {
    const session = makeSession([
      userEntry("fix the bug"),
      assistantEntry("done"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.contextCompacted).toBe(false);
  });

  it("calculates human engagement ratio", () => {
    const session = makeSession([
      userEntry("a"),
      assistantEntry("b"),
      userEntry("c"),
      assistantEntry("d"),
    ]);

    const patterns = analyzeHumanPatterns(session);
    expect(patterns.humanEngagementRatio).toBe(0.5);
  });

  it("handles empty transcript", () => {
    const session = makeSession([]);
    const patterns = analyzeHumanPatterns(session);
    expect(patterns.correctionCount).toBe(0);
    expect(patterns.shortPromptCount).toBe(0);
    expect(patterns.humanEngagementRatio).toBe(0);
  });
});

// ── calculateHealthScore ─────────────────────────────────────────────

describe("calculateHealthScore", () => {
  it("returns 100 for a clean session", () => {
    const effort = analyzeEffort(makeSession([userEntry("hi"), assistantEntry("hello")]));
    const score = calculateHealthScore([], [], [], effort);
    expect(score).toBe(100);
  });

  it("deducts for failure loops", () => {
    const effort = analyzeEffort(makeSession([]));
    const loops = [{ action: "Edit", retryCount: 4, entries: [], errorPattern: "err" }];
    const score = calculateHealthScore(loops, [], [], effort);
    expect(score).toBeLessThan(100);
    expect(score).toBe(100 - Math.min(10, 4 * 2)); // 92
  });

  it("deducts for reverted work", () => {
    const effort = analyzeEffort(makeSession([]));
    const reverted = [{ files: ["a.ts"], wastedOperations: 5 }];
    const score = calculateHealthScore([], reverted, [], effort);
    expect(score).toBe(95); // 100 - min(10, 5)
  });

  it("deducts for bash failures", () => {
    const effort = analyzeEffort(makeSession([]));
    const bashFails = Array.from({ length: 6 }, () => ({ command: "test", error: "fail" }));
    const score = calculateHealthScore([], [], bashFails, effort);
    expect(score).toBe(97); // 100 - min(10, floor(6/2)) = 100 - 3
  });

  it("deducts for excessive file churn", () => {
    const session = makeSession(
      Array.from({ length: 10 }, () => toolEntry("Edit", ["src/hot.ts"])),
    );
    const effort = analyzeEffort(session);
    const score = calculateHealthScore([], [], [], effort);
    expect(score).toBe(95); // 100 - 5 for maxTouches > 8
  });

  it("never goes below 0", () => {
    const effort = analyzeEffort(makeSession([]));
    const loops = Array.from({ length: 20 }, (_, i) => ({
      action: `Edit-${i}`,
      retryCount: 10,
      entries: [] as SessionEntry[],
      errorPattern: "err",
    }));
    const score = calculateHealthScore(loops, [], [], effort);
    expect(score).toBe(0);
  });

  it("combines multiple deductions", () => {
    const session = makeSession(
      Array.from({ length: 10 }, () => toolEntry("Edit", ["src/hot.ts"])),
    );
    const effort = analyzeEffort(session);
    const loops = [{ action: "Edit", retryCount: 3, entries: [], errorPattern: "err" }];
    const reverted = [{ files: ["a.ts"], wastedOperations: 3 }];
    const bashFails = [
      { command: "test", error: "fail" },
      { command: "test", error: "fail" },
    ];

    const score = calculateHealthScore(loops, reverted, bashFails, effort);
    // 100 - min(10, 3*2) - min(10, 3) - min(10, floor(2/2)) - 5
    // 100 - 6 - 3 - 1 - 5 = 85
    expect(score).toBe(85);
  });
});

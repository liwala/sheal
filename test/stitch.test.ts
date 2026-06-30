import { describe, it, expect } from "vitest";
import { stitchSessions, DEFAULT_GAP_MS, formatDuration, shortAgent } from "../src/browse/utils/stitch.js";
import type { CheckpointInfo } from "@liwala/agent-sessions";

function makeSession(overrides: Partial<CheckpointInfo> & { createdAt: string }): CheckpointInfo {
  return {
    checkpointId: overrides.sessionId || overrides.createdAt,
    sessionId: overrides.sessionId || overrides.createdAt,
    createdAt: overrides.createdAt,
    filesTouched: overrides.filesTouched ?? [],
    agent: overrides.agent,
    sessionCount: 1,
    sessionIds: [overrides.sessionId || overrides.createdAt],
    title: overrides.title,
    ...overrides,
  };
}

describe("stitchSessions", () => {
  it("returns empty for empty input", () => {
    expect(stitchSessions([])).toEqual([]);
  });

  it("creates a single group for a lone session", () => {
    const s = makeSession({ createdAt: "2026-04-21T10:00:00Z", agent: "Claude Code", title: "Fix bug" });
    const groups = stitchSessions([s]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(1);
    expect(groups[0].title).toBe("Fix bug");
    expect(groups[0].agents).toEqual(["Claude Code"]);
  });

  it("merges consecutive sessions within the gap threshold", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z", agent: "Claude Code", title: "Task A" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T10:30:00Z", agent: "Codex" });
    const c = makeSession({ sessionId: "c", createdAt: "2026-04-21T11:00:00Z", agent: "Claude Code" });
    const groups = stitchSessions([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
    expect(groups[0].agents.sort()).toEqual(["Claude Code", "Codex"]);
    expect(groups[0].title).toBe("Task A");
  });

  it("splits sessions separated by more than the gap", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T15:00:00Z" });
    const groups = stitchSessions([a, b]);
    expect(groups).toHaveLength(2);
    // Newest first
    expect(groups[0].sessions[0].sessionId).toBe("b");
    expect(groups[1].sessions[0].sessionId).toBe("a");
  });

  it("chains sessions across a window longer than gapMs via intermediate bridges", () => {
    // A→B is 90m, B→C is 90m. A→C is 180m > gap, but chain via B keeps them together.
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T11:30:00Z" });
    const c = makeSession({ sessionId: "c", createdAt: "2026-04-21T13:00:00Z" });
    const groups = stitchSessions([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(3);
  });

  it("handles input in arbitrary order by sorting first", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z", title: "First" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T10:30:00Z", title: "Second" });
    const groups = stitchSessions([b, a]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(["a", "b"]);
    expect(groups[0].title).toBe("First");
  });

  it("uses first non-empty title in the group", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z", title: "" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T10:30:00Z", title: "Found it" });
    const groups = stitchSessions([a, b]);
    expect(groups[0].title).toBe("Found it");
  });

  it("falls back to '(untitled)' when no session has a title", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z" });
    const groups = stitchSessions([a]);
    expect(groups[0].title).toBe("(untitled)");
  });

  it("unions filesTouched across sessions in a group", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z", filesTouched: ["foo.ts", "bar.ts"] });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T10:30:00Z", filesTouched: ["bar.ts", "baz.ts"] });
    const groups = stitchSessions([a, b]);
    expect(groups[0].filesTouched.sort()).toEqual(["bar.ts", "baz.ts", "foo.ts"]);
  });

  it("respects a custom gap", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-21T10:10:00Z" });
    // 5-minute gap — these 10-min-apart sessions should split
    const groups = stitchSessions([a, b], 5 * 60 * 1000);
    expect(groups).toHaveLength(2);
  });

  it("treats invalid dates as a boundary", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-21T10:00:00Z" });
    const b = makeSession({ sessionId: "b", createdAt: "not-a-date" });
    const groups = stitchSessions([a, b]);
    // Invalid date sorts lexically; we just make sure we don't crash and produce groups
    expect(groups.length).toBeGreaterThan(0);
  });

  it("returns groups in reverse chronological order", () => {
    const a = makeSession({ sessionId: "a", createdAt: "2026-04-19T10:00:00Z" });
    const b = makeSession({ sessionId: "b", createdAt: "2026-04-20T10:00:00Z" });
    const c = makeSession({ sessionId: "c", createdAt: "2026-04-21T10:00:00Z" });
    const groups = stitchSessions([a, b, c]);
    expect(groups).toHaveLength(3);
    expect(groups[0].sessions[0].sessionId).toBe("c");
    expect(groups[2].sessions[0].sessionId).toBe("a");
  });

  it("default gap is 2 hours", () => {
    expect(DEFAULT_GAP_MS).toBe(7200000);
  });
});

describe("formatDuration", () => {
  it("returns '-' for zero or negative", () => {
    expect(formatDuration(0)).toBe("-");
    expect(formatDuration(-100)).toBe("-");
  });
  it("formats minutes under an hour", () => {
    expect(formatDuration(45 * 60 * 1000)).toBe("45m");
  });
  it("formats whole hours", () => {
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe("2h");
  });
  it("formats hours and minutes", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 10 * 60 * 1000)).toBe("2h 10m");
  });
});

describe("shortAgent", () => {
  it("maps Claude Code → claude", () => {
    expect(shortAgent("Claude Code")).toBe("claude");
  });
  it("lowercases other agents", () => {
    expect(shortAgent("Codex")).toBe("codex");
    expect(shortAgent("Amp")).toBe("amp");
    expect(shortAgent("Gemini")).toBe("gemini");
  });
  it("handles undefined", () => {
    expect(shortAgent(undefined)).toBe("");
  });
});

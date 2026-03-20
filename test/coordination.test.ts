import { describe, it, expect } from "vitest";
import { detectCoordinationIssues } from "../src/retro/analyzers.js";
import type { Checkpoint, Session, SessionEntry } from "../src/entire/types.js";

function makeSession(overrides: {
  sessionId: string;
  agent?: string;
  filesTouched?: string[];
  transcript?: SessionEntry[];
}): Session {
  return {
    metadata: {
      checkpointId: "test-cp",
      sessionId: overrides.sessionId,
      strategy: "test",
      createdAt: "2026-03-20",
      checkpointsCount: 1,
      filesTouched: overrides.filesTouched ?? [],
      agent: overrides.agent as any,
    },
    transcript: overrides.transcript ?? [],
    prompts: [],
  };
}

function makeCheckpoint(sessions: Session[]): Checkpoint {
  return {
    root: {
      checkpointId: "test-cp",
      strategy: "test",
      checkpointsCount: 1,
      filesTouched: [],
      sessions: [],
    },
    sessions,
  };
}

function writeEntry(file: string): SessionEntry {
  return {
    uuid: "e-" + Math.random().toString(36).slice(2, 8),
    type: "tool",
    content: "",
    toolName: "Write",
    filesAffected: [file],
  };
}

function bashFailEntry(): SessionEntry {
  return {
    uuid: "e-" + Math.random().toString(36).slice(2, 8),
    type: "tool",
    content: "",
    toolName: "Bash",
    toolInput: { command: "npm test" },
    toolOutput: "Exit code 1\nError: test failed",
  };
}

describe("detectCoordinationIssues", () => {
  it("returns empty array for single session", () => {
    const cp = makeCheckpoint([makeSession({ sessionId: "s1", agent: "claude" })]);
    expect(detectCoordinationIssues(cp)).toEqual([]);
  });

  it("detects conflicting edits across sessions", () => {
    const cp = makeCheckpoint([
      makeSession({
        sessionId: "s1",
        agent: "claude",
        filesTouched: ["src/app.ts"],
        transcript: [writeEntry("src/app.ts")],
      }),
      makeSession({
        sessionId: "s2",
        agent: "gemini",
        filesTouched: ["src/app.ts"],
        transcript: [writeEntry("src/app.ts")],
      }),
    ]);

    const issues = detectCoordinationIssues(cp);
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe("conflicting-edits");
    expect(issues[0].agents).toEqual(["claude", "gemini"]);
    expect(issues[0].files).toEqual(["src/app.ts"]);
  });

  it("detects duplicated exploration", () => {
    const sharedFiles = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
    const cp = makeCheckpoint([
      makeSession({
        sessionId: "s1",
        agent: "claude",
        filesTouched: sharedFiles,
        transcript: [], // no writes, just reads
      }),
      makeSession({
        sessionId: "s2",
        agent: "gemini",
        filesTouched: sharedFiles,
        transcript: [], // no writes, just reads
      }),
    ]);

    const issues = detectCoordinationIssues(cp);
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe("duplicated-work");
  });

  it("detects missed handoffs", () => {
    // Session 1 has failures, session 2 reworks the same files
    const failEntries: SessionEntry[] = [];
    for (let i = 0; i < 4; i++) {
      failEntries.push(bashFailEntry());
      // Add error output entry
      failEntries.push({
        uuid: "r-" + i,
        type: "tool",
        content: "",
        toolOutput: "Exit code 1\nError: compilation failed",
      });
    }
    failEntries.push(writeEntry("src/app.ts"));

    const cp = makeCheckpoint([
      makeSession({
        sessionId: "s1",
        agent: "claude",
        filesTouched: ["src/app.ts"],
        transcript: failEntries,
      }),
      makeSession({
        sessionId: "s2",
        agent: "gemini",
        filesTouched: ["src/app.ts"],
        transcript: [writeEntry("src/app.ts")],
      }),
    ]);

    const issues = detectCoordinationIssues(cp);
    const handoff = issues.find((i) => i.type === "missed-handoff");
    expect(handoff).toBeDefined();
    expect(handoff!.files).toContain("src/app.ts");
  });

  it("reports no issues when sessions touch different files", () => {
    const cp = makeCheckpoint([
      makeSession({
        sessionId: "s1",
        agent: "claude",
        filesTouched: ["src/a.ts"],
        transcript: [writeEntry("src/a.ts")],
      }),
      makeSession({
        sessionId: "s2",
        agent: "gemini",
        filesTouched: ["src/b.ts"],
        transcript: [writeEntry("src/b.ts")],
      }),
    ]);

    const issues = detectCoordinationIssues(cp);
    expect(issues.length).toBe(0);
  });

  it("rates severity high for 3+ conflicting files", () => {
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const cp = makeCheckpoint([
      makeSession({
        sessionId: "s1",
        agent: "claude",
        transcript: files.map(writeEntry),
      }),
      makeSession({
        sessionId: "s2",
        agent: "gemini",
        transcript: files.map(writeEntry),
      }),
    ]);

    const issues = detectCoordinationIssues(cp);
    expect(issues[0].severity).toBe("high");
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@liwala/agent-sessions", () => ({
  listAllNativeProjects: () => [
    {
      slug: "claude-proj",
      projectPath: "/tmp/claude-proj",
      name: "claude-proj",
      sessionCount: 1,
      lastModified: "2026-05-01T10:00:00.000Z",
    },
  ],
  listNativeSessionsBySlug: () => [
    {
      checkpointId: "claude-session",
      sessionId: "claude-session",
      createdAt: "2026-05-01T10:00:00.000Z",
      filesTouched: [],
      agent: "Claude Code",
      sessionCount: 1,
      sessionIds: ["claude-session"],
      title: "Claude prompt",
    },
  ],
  loadNativeSessionBySlug: () => ({
    root: {
      checkpointId: "claude-session",
      strategy: "native",
      checkpointsCount: 0,
      filesTouched: [],
      sessions: [],
    },
    sessions: [
      {
        metadata: {
          checkpointId: "claude-session",
          sessionId: "claude-session",
          strategy: "native",
          createdAt: "2026-05-01T10:00:00.000Z",
          checkpointsCount: 0,
          filesTouched: [],
          agent: "Claude Code",
        },
        transcript: [],
        prompts: ["Claude user prompt"],
      },
    ],
  }),
  listCodexProjects: () => [
    {
      slug: "codex:/tmp/codex-proj",
      projectPath: "/tmp/codex-proj",
      name: "codex-proj",
      sessionCount: 1,
      lastModified: "2026-05-01T11:00:00.000Z",
    },
  ],
  listCodexSessionsForProject: () => [
    {
      checkpointId: "codex-session",
      sessionId: "codex-session",
      createdAt: "2026-05-01T11:00:00.000Z",
      filesTouched: [],
      agent: "Codex",
      sessionCount: 1,
      sessionIds: ["codex-session"],
      title: "Codex prompt",
    },
  ],
  loadCodexSession: () => ({
    meta: {
      id: "codex-session",
      path: "/tmp/codex-session.jsonl",
      cwd: "/tmp/codex-proj",
      timestamp: "2026-05-01T11:00:00.000Z",
    },
    entries: [{ role: "user", content: "Codex user prompt" }],
  }),
  listAmpProjects: () => [],
}));

describe("loadSessionsInWindow", () => {
  it("reports per-agent session counts independently from token usage", async () => {
    const { loadSessionsInWindow } = await import("../src/digest/loader.js");

    const result = loadSessionsInWindow({
      since: new Date("2026-05-01T00:00:00.000Z"),
      until: new Date("2026-05-02T00:00:00.000Z"),
    });

    expect(result.sessionCount).toBe(2);
    expect(result.prompts.map((p) => p.agent).sort()).toEqual(["claude", "codex"]);
    expect(result.agentScans.find((s) => s.agent === "claude")?.sessionCount).toBe(1);
    expect(result.agentScans.find((s) => s.agent === "codex")?.sessionCount).toBe(1);
  });
});

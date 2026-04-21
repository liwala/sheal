import { describe, it, expect } from "vitest";
import { analyzeAgents } from "../src/agents/analyze.js";
import type { ProjectTasks } from "../src/agents/analyze.js";
import type { TaskGroup } from "../src/browse/utils/stitch.js";
import type { CheckpointInfo } from "../src/entire/types.js";

function session(agent: string, createdAt: string, overrides: Partial<CheckpointInfo> = {}): CheckpointInfo {
  return {
    checkpointId: overrides.sessionId || createdAt,
    sessionId: overrides.sessionId || createdAt,
    createdAt,
    filesTouched: overrides.filesTouched ?? [],
    agent,
    sessionCount: 1,
    sessionIds: [overrides.sessionId || createdAt],
    title: overrides.title,
  };
}

function task(sessions: CheckpointInfo[], title = ""): TaskGroup {
  const agents = [...new Set(sessions.map((s) => s.agent || "unknown"))];
  return {
    id: sessions[0].sessionId,
    title: title || sessions[0].title || "(untitled)",
    startAt: sessions[0].createdAt,
    endAt: sessions[sessions.length - 1].createdAt,
    sessions,
    agents,
    filesTouched: [],
  };
}

describe("analyzeAgents", () => {
  it("handles empty input", () => {
    const a = analyzeAgents([]);
    expect(a.scope.projects).toBe(0);
    expect(a.tasks.total).toBe(0);
    expect(a.sessions.total).toBe(0);
    expect(a.agentShares).toEqual([]);
  });

  it("counts sessions per agent", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [
          task([session("Claude Code", "2026-04-20T10:00:00Z"), session("Codex", "2026-04-20T10:30:00Z")]),
        ],
      },
    ];
    const a = analyzeAgents(input);
    expect(a.sessions.total).toBe(2);
    const shares = Object.fromEntries(a.agentShares.map((s) => [s.agent, s.sessions]));
    expect(shares).toEqual({ claude: 1, codex: 1 });
  });

  it("classifies solo vs mixed tasks", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [
          // solo claude
          task([session("Claude Code", "2026-04-20T10:00:00Z")]),
          // solo codex
          task([session("Codex", "2026-04-20T11:00:00Z")]),
          // mixed
          task([
            session("Claude Code", "2026-04-20T12:00:00Z"),
            session("Codex", "2026-04-20T12:30:00Z"),
          ]),
        ],
      },
    ];
    const a = analyzeAgents(input);
    expect(a.tasks.total).toBe(3);
    expect(a.tasks.solo).toBe(2);
    expect(a.tasks.multiAgent).toBe(1);
    const solo = Object.fromEntries(a.taskComposition.solo.map((s) => [s.agent, s.count]));
    expect(solo).toEqual({ claude: 1, codex: 1 });
    expect(a.taskComposition.mixed).toEqual([{ combo: "claude+codex", count: 1 }]);
  });

  it("tallies cross-agent handoffs only", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [
          task([
            session("Claude Code", "2026-04-20T10:00:00Z"),
            session("Claude Code", "2026-04-20T10:15:00Z"), // self-transition, not counted
            session("Codex", "2026-04-20T10:30:00Z"),       // claude→codex
            session("Claude Code", "2026-04-20T10:45:00Z"), // codex→claude
          ]),
        ],
      },
    ];
    const a = analyzeAgents(input);
    const handoffMap = Object.fromEntries(a.handoffs.map((h) => [`${h.from}>${h.to}`, h.count]));
    expect(handoffMap).toEqual({ "claude>codex": 1, "codex>claude": 1 });
  });

  it("tracks who opens and closes tasks", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [
          task([session("Claude Code", "2026-04-20T10:00:00Z"), session("Codex", "2026-04-20T10:30:00Z")]),
          task([session("Codex", "2026-04-20T11:00:00Z"), session("Claude Code", "2026-04-20T11:30:00Z")]),
          task([session("Claude Code", "2026-04-20T12:00:00Z")]),
        ],
      },
    ];
    const a = analyzeAgents(input);
    const opens = Object.fromEntries(a.opens.map((s) => [s.agent, s.count]));
    const closes = Object.fromEntries(a.closes.map((s) => [s.agent, s.count]));
    expect(opens).toEqual({ claude: 2, codex: 1 });
    expect(closes).toEqual({ claude: 2, codex: 1 });
  });

  it("counts multi-agent projects", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [task([session("Claude Code", "2026-04-20T10:00:00Z"), session("Codex", "2026-04-20T10:30:00Z")])],
      },
      {
        project: "beta",
        tasks: [task([session("Claude Code", "2026-04-20T10:00:00Z")])],
      },
      {
        project: "gamma",
        tasks: [task([session("Amp", "2026-04-20T10:00:00Z")])],
      },
    ];
    const a = analyzeAgents(input);
    expect(a.scope.projects).toBe(3);
    expect(a.scope.multiAgentProjects).toBe(1);
  });

  it("orders top mixed tasks by session count", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [
          task(
            [
              session("Claude Code", "2026-04-20T10:00:00Z"),
              session("Codex", "2026-04-20T10:30:00Z"),
            ],
            "small mixed",
          ),
          task(
            [
              session("Claude Code", "2026-04-21T10:00:00Z"),
              session("Codex", "2026-04-21T10:30:00Z"),
              session("Claude Code", "2026-04-21T11:00:00Z"),
              session("Amp", "2026-04-21T11:30:00Z"),
            ],
            "big mixed",
          ),
        ],
      },
    ];
    const a = analyzeAgents(input);
    expect(a.topMixedTasks).toHaveLength(2);
    expect(a.topMixedTasks[0].title).toBe("big mixed");
    expect(a.topMixedTasks[0].sessionCount).toBe(4);
    expect(a.topMixedTasks[0].agents.sort()).toEqual(["amp", "claude", "codex"]);
  });

  it("limits topMixedTasks to topN", () => {
    const tasks: TaskGroup[] = [];
    for (let i = 0; i < 15; i++) {
      tasks.push(
        task([
          session("Claude Code", `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
          session("Codex", `2026-04-${String(i + 1).padStart(2, "0")}T10:30:00Z`),
        ]),
      );
    }
    const a = analyzeAgents([{ project: "x", tasks }], 5);
    expect(a.topMixedTasks).toHaveLength(5);
  });

  it("computes agent share percentages", () => {
    const input: ProjectTasks[] = [
      {
        project: "alpha",
        tasks: [
          task([
            session("Claude Code", "2026-04-20T10:00:00Z"),
            session("Claude Code", "2026-04-20T10:15:00Z"),
            session("Claude Code", "2026-04-20T10:30:00Z"),
            session("Codex", "2026-04-20T10:45:00Z"),
          ]),
        ],
      },
    ];
    const a = analyzeAgents(input);
    const claude = a.agentShares.find((s) => s.agent === "claude")!;
    const codex = a.agentShares.find((s) => s.agent === "codex")!;
    expect(claude.pct).toBe(75);
    expect(codex.pct).toBe(25);
  });
});

import { describe, it, expect } from "vitest";
import type { KnowledgeGraph, FileNode, AgentNode, SessionNode, SessionCorrelation } from "../src/graph/types.js";

function makeGraph(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return {
    project: "/test/project",
    builtAt: new Date().toISOString(),
    files: new Map(),
    agents: new Map(),
    sessions: [],
    hotFiles: [],
    correlations: [],
    stats: { totalSessions: 0, totalFiles: 0, totalAgents: 0, dateRange: { earliest: "", latest: "" } },
    ...overrides,
  };
}

describe("KnowledgeGraph types", () => {
  it("can represent a multi-agent graph", () => {
    const files = new Map<string, FileNode>();
    files.set("src/app.ts", {
      path: "src/app.ts",
      sessions: [
        { sessionId: "s1", agent: "Claude Code", date: "2026-03-20", touchCount: 3 },
        { sessionId: "s2", agent: "Amp", date: "2026-03-20", touchCount: 1 },
      ],
      totalTouches: 4,
      agents: ["Claude Code", "Amp"],
    });

    const agents = new Map<string, AgentNode>();
    agents.set("Claude Code", {
      name: "Claude Code",
      sessionCount: 5,
      files: ["src/app.ts", "src/index.ts"],
      totalToolCalls: 120,
      sessionIds: ["s1", "s3", "s4", "s5", "s6"],
    });

    const graph = makeGraph({ files, agents, stats: { totalSessions: 5, totalFiles: 1, totalAgents: 2, dateRange: { earliest: "2026-03-20", latest: "2026-03-21" } } });

    expect(graph.stats.totalAgents).toBe(2);
    expect(graph.files.get("src/app.ts")?.agents).toContain("Amp");
    expect(graph.agents.get("Claude Code")?.sessionCount).toBe(5);
  });

  it("hotFiles are sorted by totalTouches descending", () => {
    const hotFiles = [
      { path: "a.ts", totalTouches: 10, agentCount: 1 },
      { path: "b.ts", totalTouches: 20, agentCount: 2 },
      { path: "c.ts", totalTouches: 5, agentCount: 1 },
    ].sort((a, b) => b.totalTouches - a.totalTouches);

    expect(hotFiles[0].path).toBe("b.ts");
    expect(hotFiles[2].path).toBe("c.ts");
  });
});

describe("SessionCorrelation", () => {
  it("detects cross-agent file overlap", () => {
    const correlation: SessionCorrelation = {
      sessions: [
        { sessionId: "s1", agent: "Claude Code", date: "2026-03-20T10:00:00Z" },
        { sessionId: "s2", agent: "Amp", date: "2026-03-20T10:30:00Z" },
      ],
      sharedFiles: ["src/app.ts", "src/index.ts"],
      timeGapMinutes: 30,
      crossAgent: true,
      description: "Claude Code and Amp touched 2 shared file(s) 30min apart",
    };

    expect(correlation.crossAgent).toBe(true);
    expect(correlation.sharedFiles).toHaveLength(2);
    expect(correlation.timeGapMinutes).toBe(30);
  });

  it("detects same-agent session overlap", () => {
    const correlation: SessionCorrelation = {
      sessions: [
        { sessionId: "s1", agent: "Claude Code", date: "2026-03-20T09:00:00Z" },
        { sessionId: "s2", agent: "Claude Code", date: "2026-03-20T09:45:00Z" },
      ],
      sharedFiles: ["src/app.ts"],
      timeGapMinutes: 45,
      crossAgent: false,
      description: "Two Claude Code sessions touched 1 shared file(s) 45min apart",
    };

    expect(correlation.crossAgent).toBe(false);
    expect(correlation.sharedFiles).toContain("src/app.ts");
  });

  it("correlations sort cross-agent first", () => {
    const correlations: SessionCorrelation[] = [
      {
        sessions: [], sharedFiles: ["a.ts"], timeGapMinutes: 10,
        crossAgent: false, description: "same agent",
      },
      {
        sessions: [], sharedFiles: ["a.ts", "b.ts"], timeGapMinutes: 5,
        crossAgent: true, description: "cross agent",
      },
    ];

    correlations.sort((a, b) => {
      if (a.crossAgent !== b.crossAgent) return a.crossAgent ? -1 : 1;
      return b.sharedFiles.length - a.sharedFiles.length;
    });

    expect(correlations[0].crossAgent).toBe(true);
  });
});

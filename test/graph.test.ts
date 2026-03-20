import { describe, it, expect } from "vitest";
import type { KnowledgeGraph, FileNode, AgentNode, SessionNode } from "../src/graph/types.js";

describe("KnowledgeGraph types", () => {
  it("can represent a multi-session graph", () => {
    const files = new Map<string, FileNode>();
    files.set("src/app.ts", {
      path: "src/app.ts",
      sessions: [
        { sessionId: "s1", agent: "Claude Code", date: "2026-03-20", touchCount: 3 },
        { sessionId: "s2", agent: "Gemini CLI", date: "2026-03-21", touchCount: 1 },
      ],
      totalTouches: 4,
      agents: ["Claude Code", "Gemini CLI"],
    });

    const agents = new Map<string, AgentNode>();
    agents.set("Claude Code", {
      name: "Claude Code",
      sessionCount: 5,
      files: ["src/app.ts", "src/index.ts"],
      totalToolCalls: 120,
      sessionIds: ["s1", "s3", "s4", "s5", "s6"],
    });

    const graph: KnowledgeGraph = {
      project: "/test/project",
      builtAt: new Date().toISOString(),
      files,
      agents,
      sessions: [
        {
          sessionId: "s1",
          agent: "Claude Code",
          date: "2026-03-20",
          title: "Fix build",
          filesTouched: ["src/app.ts"],
          toolCounts: { Write: 2, Bash: 5 },
        },
      ],
      hotFiles: [{ path: "src/app.ts", totalTouches: 4, agentCount: 2 }],
      stats: {
        totalSessions: 1,
        totalFiles: 1,
        totalAgents: 2,
        dateRange: { earliest: "2026-03-20", latest: "2026-03-21" },
      },
    };

    expect(graph.stats.totalAgents).toBe(2);
    expect(graph.files.get("src/app.ts")?.agents).toContain("Gemini CLI");
    expect(graph.hotFiles[0].totalTouches).toBe(4);
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

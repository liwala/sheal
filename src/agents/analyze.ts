/**
 * Aggregate analysis of multi-agent usage across stitched task timelines.
 *
 * Takes the output of stitchSessions for one or more projects and produces a
 * descriptive report: agent share, solo-vs-mixed task composition, handoff
 * matrix, open/close distribution, and a sample of top mixed-agent tasks.
 */
import type { TaskGroup } from "../browse/utils/stitch.js";
import { shortAgent } from "../browse/utils/stitch.js";

export interface ProjectTasks {
  project: string;
  tasks: TaskGroup[];
}

export interface AgentShare {
  agent: string;
  sessions: number;
  pct: number;
}

export interface Handoff {
  from: string;
  to: string;
  count: number;
}

export interface OpenClose {
  agent: string;
  count: number;
}

export interface MixedTaskSample {
  project: string;
  startAt: string;
  endAt: string;
  agents: string[];
  sessionCount: number;
  title?: string;
}

export interface AgentAnalysis {
  scope: {
    projects: number;
    multiAgentProjects: number;
  };
  tasks: {
    total: number;
    solo: number;
    multiAgent: number;
  };
  sessions: {
    total: number;
  };
  agentShares: AgentShare[];
  taskComposition: {
    solo: OpenClose[];
    mixed: Array<{ combo: string; count: number }>;
  };
  handoffs: Handoff[];
  opens: OpenClose[];
  closes: OpenClose[];
  topMixedTasks: MixedTaskSample[];
}

const UNKNOWN = "unknown";

function labelOf(agent: string | undefined): string {
  return shortAgent(agent) || UNKNOWN;
}

function sortByCountDesc<T extends { count: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => b.count - a.count);
}

function toArray<K extends string>(m: Map<K, number>): Array<{ key: K; count: number }> {
  return [...m.entries()].map(([key, count]) => ({ key, count }));
}

/**
 * Analyze agent collaboration patterns across a set of per-project tasks.
 */
export function analyzeAgents(input: ProjectTasks[], topN: number = 10): AgentAnalysis {
  let totalSessions = 0;
  let multiAgentProjects = 0;

  const agentSessions = new Map<string, number>();
  const soloCounts = new Map<string, number>();
  const mixedCounts = new Map<string, number>();
  const opens = new Map<string, number>();
  const closes = new Map<string, number>();
  const handoffs = new Map<string, number>(); // "from>to" → count

  const mixedSamples: MixedTaskSample[] = [];
  let totalTasks = 0;
  let multiAgentTasks = 0;

  for (const { project, tasks } of input) {
    const projectAgents = new Set<string>();
    totalTasks += tasks.length;

    for (const task of tasks) {
      const taskAgents = task.sessions.map((s) => labelOf(s.agent));
      const uniqueAgents = [...new Set(taskAgents)].sort();

      totalSessions += task.sessions.length;
      for (const a of taskAgents) {
        agentSessions.set(a, (agentSessions.get(a) ?? 0) + 1);
        projectAgents.add(a);
      }

      // Opens / closes.
      const first = taskAgents[0];
      const last = taskAgents[taskAgents.length - 1];
      opens.set(first, (opens.get(first) ?? 0) + 1);
      closes.set(last, (closes.get(last) ?? 0) + 1);

      // Composition.
      if (uniqueAgents.length === 1) {
        soloCounts.set(uniqueAgents[0], (soloCounts.get(uniqueAgents[0]) ?? 0) + 1);
      } else {
        multiAgentTasks++;
        const combo = uniqueAgents.join("+");
        mixedCounts.set(combo, (mixedCounts.get(combo) ?? 0) + 1);

        mixedSamples.push({
          project,
          startAt: task.startAt,
          endAt: task.endAt,
          agents: uniqueAgents,
          sessionCount: task.sessions.length,
          title: task.title,
        });
      }

      // Handoffs — only cross-agent transitions between consecutive sessions.
      for (let i = 1; i < taskAgents.length; i++) {
        const from = taskAgents[i - 1];
        const to = taskAgents[i];
        if (from === to) continue;
        const key = `${from}>${to}`;
        handoffs.set(key, (handoffs.get(key) ?? 0) + 1);
      }
    }

    if (projectAgents.size > 1) multiAgentProjects++;
  }

  const agentShares: AgentShare[] = sortByCountDesc(
    toArray(agentSessions).map(({ key, count }) => ({
      agent: key,
      sessions: count,
      pct: totalSessions === 0 ? 0 : Math.round((count / totalSessions) * 1000) / 10,
      count,
    })),
  ).map(({ agent, sessions, pct }) => ({ agent, sessions, pct }));

  const solo: OpenClose[] = sortByCountDesc(
    toArray(soloCounts).map(({ key, count }) => ({ agent: key, count })),
  );

  const mixed = sortByCountDesc(
    toArray(mixedCounts).map(({ key, count }) => ({ combo: key, count })),
  );

  const handoffsArr: Handoff[] = sortByCountDesc(
    [...handoffs.entries()].map(([key, count]) => {
      const [from, to] = key.split(">");
      return { from, to, count };
    }),
  );

  const opensArr: OpenClose[] = sortByCountDesc(
    toArray(opens).map(({ key, count }) => ({ agent: key, count })),
  );
  const closesArr: OpenClose[] = sortByCountDesc(
    toArray(closes).map(({ key, count }) => ({ agent: key, count })),
  );

  // Top mixed tasks by session count, then by duration.
  const topMixedTasks = mixedSamples
    .sort((a, b) => {
      if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
      const dA = new Date(a.endAt).getTime() - new Date(a.startAt).getTime();
      const dB = new Date(b.endAt).getTime() - new Date(b.startAt).getTime();
      return dB - dA;
    })
    .slice(0, topN);

  return {
    scope: { projects: input.length, multiAgentProjects },
    tasks: { total: totalTasks, solo: totalTasks - multiAgentTasks, multiAgent: multiAgentTasks },
    sessions: { total: totalSessions },
    agentShares,
    taskComposition: { solo, mixed },
    handoffs: handoffsArr,
    opens: opensArr,
    closes: closesArr,
    topMixedTasks,
  };
}

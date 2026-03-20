/**
 * Build a cross-session knowledge graph from session history.
 */

import type { CheckpointInfo } from "../entire/types.js";
import { listNativeSessions, loadNativeSession } from "../entire/claude-native.js";
import { analyzeEffort } from "../retro/analyzers.js";
import type { KnowledgeGraph, FileNode, AgentNode, SessionNode } from "./types.js";

export interface BuildGraphOptions {
  projectRoot: string;
  /** Max sessions to load (default: 50). Loading transcripts is expensive. */
  limit?: number;
}

export function buildKnowledgeGraph(options: BuildGraphOptions): KnowledgeGraph {
  const { projectRoot, limit = 50 } = options;

  const listings = listNativeSessions(projectRoot);
  const toLoad = listings.slice(0, limit);

  const files = new Map<string, FileNode>();
  const agents = new Map<string, AgentNode>();
  const sessions: SessionNode[] = [];

  for (const info of toLoad) {
    const cp = loadNativeSession(projectRoot, info.sessionId);
    if (!cp || cp.sessions.length === 0) continue;

    const session = cp.sessions[0];
    const effort = analyzeEffort(session);
    const agent = session.metadata.agent ?? "unknown";
    const date = session.metadata.createdAt;
    const sid = session.metadata.sessionId;
    const touched = session.metadata.filesTouched;
    const title = info.title ?? session.prompts[0]?.slice(0, 80) ?? "(untitled)";

    // Session node
    sessions.push({
      sessionId: sid,
      agent,
      date,
      title,
      filesTouched: touched,
      toolCounts: effort.toolCounts,
    });

    // File nodes
    for (const filePath of touched) {
      const touchCount = effort.fileTouchCounts[filePath] ?? 1;
      if (!files.has(filePath)) {
        files.set(filePath, {
          path: filePath,
          sessions: [],
          totalTouches: 0,
          agents: [],
        });
      }
      const fnode = files.get(filePath)!;
      fnode.sessions.push({ sessionId: sid, agent, date, touchCount });
      fnode.totalTouches += touchCount;
      if (!fnode.agents.includes(agent)) {
        fnode.agents.push(agent);
      }
    }

    // Agent node
    if (!agents.has(agent)) {
      agents.set(agent, {
        name: agent,
        sessionCount: 0,
        files: [],
        totalToolCalls: 0,
        sessionIds: [],
      });
    }
    const anode = agents.get(agent)!;
    anode.sessionCount++;
    anode.sessionIds.push(sid);
    anode.totalToolCalls += Object.values(effort.toolCounts).reduce((a, b) => a + b, 0);
    for (const f of touched) {
      if (!anode.files.includes(f)) {
        anode.files.push(f);
      }
    }
  }

  // Sort file sessions by date
  for (const fnode of files.values()) {
    fnode.sessions.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Hot files: most modified across sessions
  const hotFiles = [...files.values()]
    .map((f) => ({ path: f.path, totalTouches: f.totalTouches, agentCount: f.agents.length }))
    .sort((a, b) => b.totalTouches - a.totalTouches)
    .slice(0, 20);

  const dates = sessions.map((s) => s.date).filter(Boolean).sort();

  return {
    project: projectRoot,
    builtAt: new Date().toISOString(),
    files,
    agents,
    sessions,
    hotFiles,
    stats: {
      totalSessions: sessions.length,
      totalFiles: files.size,
      totalAgents: agents.size,
      dateRange: {
        earliest: dates[0] ?? "",
        latest: dates[dates.length - 1] ?? "",
      },
    },
  };
}

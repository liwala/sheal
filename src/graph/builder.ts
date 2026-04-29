/**
 * Build a cross-session knowledge graph from session history.
 * Loads sessions from all agent sources (Claude Code, Amp, Codex).
 */

import type { CheckpointInfo } from "@liwala/agent-sessions";
import { listNativeSessions, loadNativeSession } from "@liwala/agent-sessions";
import { listAmpSessionsForProject } from "@liwala/agent-sessions";
import { listCodexSessionsForProject } from "@liwala/agent-sessions";
import { analyzeEffort } from "../retro/analyzers.js";
import type { KnowledgeGraph, FileNode, AgentNode, SessionNode, SessionCorrelation } from "./types.js";

export interface BuildGraphOptions {
  projectRoot: string;
  /** Max sessions to load per agent (default: 50). */
  limit?: number;
  /** Time window in minutes for correlation detection (default: 120). */
  correlationWindowMinutes?: number;
}

/**
 * Collect sessions from all agent sources for a project.
 */
function collectAllSessions(projectRoot: string, limit: number): CheckpointInfo[] {
  const all: CheckpointInfo[] = [];

  // Claude Code
  all.push(...listNativeSessions(projectRoot).slice(0, limit));

  // Amp
  try {
    all.push(...listAmpSessionsForProject(projectRoot).slice(0, limit));
  } catch {
    // Amp not available
  }

  // Codex
  try {
    all.push(...listCodexSessionsForProject(projectRoot).slice(0, limit));
  } catch {
    // Codex not available
  }

  // Sort by date, most recent first
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.slice(0, limit);
}

export function buildKnowledgeGraph(options: BuildGraphOptions): KnowledgeGraph {
  const { projectRoot, limit = 50, correlationWindowMinutes = 120 } = options;

  const listings = collectAllSessions(projectRoot, limit);

  const files = new Map<string, FileNode>();
  const agents = new Map<string, AgentNode>();
  const sessions: SessionNode[] = [];

  for (const info of listings) {
    const agent = info.agent ?? "unknown";
    const date = info.createdAt;
    const sid = info.sessionId;
    let touched = info.filesTouched;
    let toolCounts: Record<string, number> = {};

    // For Claude Code sessions, load full transcript for detailed analysis
    if (agent === "Claude Code" && touched.length === 0) {
      const cp = loadNativeSession(projectRoot, sid);
      if (!cp || cp.sessions.length === 0) continue;
      const session = cp.sessions[0];
      const effort = analyzeEffort(session);
      touched = session.metadata.filesTouched;
      toolCounts = effort.toolCounts;

      // Update file touch counts from effort data
      for (const filePath of touched) {
        const touchCount = effort.fileTouchCounts[filePath] ?? 1;
        addFileNode(files, filePath, sid, agent, date, touchCount);
      }
    } else {
      // Amp/Codex: use listing data (1 touch per file)
      for (const filePath of touched) {
        addFileNode(files, filePath, sid, agent, date, 1);
      }
    }

    const title = info.title ?? "(untitled)";
    sessions.push({ sessionId: sid, agent, date, title, filesTouched: touched, toolCounts });

    // Agent node
    if (!agents.has(agent)) {
      agents.set(agent, { name: agent, sessionCount: 0, files: [], totalToolCalls: 0, sessionIds: [] });
    }
    const anode = agents.get(agent)!;
    anode.sessionCount++;
    anode.sessionIds.push(sid);
    anode.totalToolCalls += Object.values(toolCounts).reduce((a, b) => a + b, 0);
    for (const f of touched) {
      if (!anode.files.includes(f)) anode.files.push(f);
    }
  }

  // Sort file sessions by date
  for (const fnode of files.values()) {
    fnode.sessions.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Hot files
  const hotFiles = [...files.values()]
    .map((f) => ({ path: f.path, totalTouches: f.totalTouches, agentCount: f.agents.length }))
    .sort((a, b) => b.totalTouches - a.totalTouches)
    .slice(0, 20);

  // Correlations
  const correlations = detectCorrelations(sessions, correlationWindowMinutes);

  const dates = sessions.map((s) => s.date).filter(Boolean).sort();

  return {
    project: projectRoot,
    builtAt: new Date().toISOString(),
    files,
    agents,
    sessions,
    hotFiles,
    correlations,
    stats: {
      totalSessions: sessions.length,
      totalFiles: files.size,
      totalAgents: agents.size,
      dateRange: { earliest: dates[0] ?? "", latest: dates[dates.length - 1] ?? "" },
    },
  };
}

function addFileNode(
  files: Map<string, FileNode>,
  filePath: string,
  sessionId: string,
  agent: string,
  date: string,
  touchCount: number,
): void {
  if (!files.has(filePath)) {
    files.set(filePath, { path: filePath, sessions: [], totalTouches: 0, agents: [] });
  }
  const fnode = files.get(filePath)!;
  fnode.sessions.push({ sessionId, agent, date, touchCount });
  fnode.totalTouches += touchCount;
  if (!fnode.agents.includes(agent)) fnode.agents.push(agent);
}

/**
 * Detect correlations between sessions that touched the same files
 * within a time window. Works across agents AND within the same agent.
 */
function detectCorrelations(sessions: SessionNode[], windowMinutes: number): SessionCorrelation[] {
  const correlations: SessionCorrelation[] = [];
  const windowMs = windowMinutes * 60 * 1000;

  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];

      // Skip sessions with no file data
      if (a.filesTouched.length === 0 || b.filesTouched.length === 0) continue;

      // Check time proximity
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      const gap = Math.abs(timeA - timeB);
      if (gap > windowMs) continue;

      // Check file overlap
      const aFiles = new Set(a.filesTouched);
      const shared = b.filesTouched.filter((f) => aFiles.has(f));
      if (shared.length === 0) continue;

      const crossAgent = a.agent !== b.agent;
      const gapMinutes = Math.round(gap / 60000);

      const agentDesc = crossAgent
        ? `${a.agent} and ${b.agent}`
        : `Two ${a.agent} sessions`;
      const timeDesc = gapMinutes < 1
        ? "at the same time"
        : gapMinutes < 60
          ? `${gapMinutes}min apart`
          : `${Math.round(gapMinutes / 60)}h apart`;

      correlations.push({
        sessions: [
          { sessionId: a.sessionId, agent: a.agent, date: a.date },
          { sessionId: b.sessionId, agent: b.agent, date: b.date },
        ],
        sharedFiles: shared,
        timeGapMinutes: gapMinutes,
        crossAgent,
        description: `${agentDesc} touched ${shared.length} shared file(s) ${timeDesc}`,
      });
    }
  }

  // Sort: cross-agent first, then by number of shared files descending
  correlations.sort((a, b) => {
    if (a.crossAgent !== b.crossAgent) return a.crossAgent ? -1 : 1;
    return b.sharedFiles.length - a.sharedFiles.length;
  });

  return correlations;
}

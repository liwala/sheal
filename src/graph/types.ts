/**
 * Cross-session knowledge graph types.
 *
 * The graph captures relationships between files, sessions, agents, and learnings
 * across all recorded sessions for a project.
 */

export interface FileNode {
  path: string;
  /** Sessions that touched this file, ordered by time */
  sessions: Array<{
    sessionId: string;
    agent: string;
    date: string;
    /** Number of tool operations on this file in the session */
    touchCount: number;
  }>;
  /** Total times this file was modified across all sessions */
  totalTouches: number;
  /** Agents that have modified this file */
  agents: string[];
}

export interface AgentNode {
  name: string;
  /** Number of sessions by this agent */
  sessionCount: number;
  /** All files this agent has touched */
  files: string[];
  /** Total tool calls across all sessions */
  totalToolCalls: number;
  /** Sessions by this agent */
  sessionIds: string[];
}

export interface SessionNode {
  sessionId: string;
  agent: string;
  date: string;
  title: string;
  filesTouched: string[];
  toolCounts: Record<string, number>;
  healthScore?: number;
}

export interface KnowledgeGraph {
  /** Project identifier */
  project: string;
  /** When this graph was built */
  builtAt: string;
  /** File-centric view: which sessions/agents touched each file */
  files: Map<string, FileNode>;
  /** Agent-centric view: what each agent worked on */
  agents: Map<string, AgentNode>;
  /** Session list with metadata */
  sessions: SessionNode[];
  /** Hot files: most frequently modified across sessions */
  hotFiles: Array<{ path: string; totalTouches: number; agentCount: number }>;
  /** Summary stats */
  stats: {
    totalSessions: number;
    totalFiles: number;
    totalAgents: number;
    dateRange: { earliest: string; latest: string };
  };
}

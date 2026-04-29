/**
 * Shared types for AI coding agent session data.
 *
 * Used as the normalized shape across native readers (Claude Code, Codex,
 * Amp, Gemini) and the Entire.io checkpoint reader. The model originates
 * from Entire.io's Go data model and stays compatible with it.
 */

export type AgentType = "Claude Code" | "Cursor" | "Gemini CLI" | "OpenCode" | "Copilot CLI" | string;

export type EntryType = "user" | "assistant" | "tool" | "system";

/**
 * A single entry in a session transcript.
 */
export interface SessionEntry {
  uuid: string;
  type: EntryType;
  timestamp?: string;
  content: string;

  // Tool-specific fields
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  filesAffected?: string[];
}

/**
 * Token usage for a checkpoint, matching Entire.io's TokenUsage struct.
 */
export interface TokenUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  apiCallCount: number;
  subagentTokens?: TokenUsage;
}

/**
 * Session metrics from agent hooks.
 */
export interface SessionMetrics {
  durationMs?: number;
  turnCount?: number;
  contextTokens?: number;
  contextWindowSize?: number;
}

/**
 * AI-generated summary of a checkpoint.
 */
export interface CheckpointSummary {
  intent: string;
  outcome: string;
  learnings: {
    repo: string[];
    code: CodeLearning[];
    workflow: string[];
  };
  friction: string[];
  openItems: string[];
}

export interface CodeLearning {
  path: string;
  line?: number;
  endLine?: number;
  finding: string;
}

/**
 * Line-level attribution metrics.
 */
export interface InitialAttribution {
  calculatedAt: string;
  agentLines: number;
  humanAdded: number;
  humanModified: number;
  humanRemoved: number;
  totalCommitted: number;
  agentPercentage: number;
}

/**
 * Metadata for a committed checkpoint session, matching CommittedMetadata.
 */
export interface SessionMetadata {
  cliVersion?: string;
  checkpointId: string;
  sessionId: string;
  strategy: string;
  createdAt: string;
  branch?: string;
  checkpointsCount: number;
  filesTouched: string[];
  agent?: AgentType;
  model?: string;
  turnId?: string;
  isTask?: boolean;
  toolUseId?: string;
  tokenUsage?: TokenUsage;
  sessionMetrics?: SessionMetrics;
  summary?: CheckpointSummary;
  initialAttribution?: InitialAttribution;
  checkpointTranscriptStart?: number;
}

/**
 * Root-level checkpoint summary (aggregates across sessions).
 */
export interface CheckpointRoot {
  cliVersion?: string;
  checkpointId: string;
  strategy: string;
  branch?: string;
  checkpointsCount: number;
  filesTouched: string[];
  sessions: SessionFilePaths[];
  tokenUsage?: TokenUsage;
}

export interface SessionFilePaths {
  metadata: string;
  transcript: string;
  contentHash: string;
  prompt: string;
}

/**
 * A fully loaded session with all data resolved.
 */
export interface Session {
  metadata: SessionMetadata;
  transcript: SessionEntry[];
  prompts: string[];
  rawTranscript?: string;
}

/**
 * A fully loaded checkpoint with all sessions resolved.
 */
export interface Checkpoint {
  root: CheckpointRoot;
  sessions: Session[];
}

/**
 * Listing info for a committed checkpoint (lightweight, no transcript loaded).
 */
export interface CheckpointInfo {
  checkpointId: string;
  sessionId: string;
  createdAt: string;
  filesTouched: string[];
  agent?: AgentType;
  isTask?: boolean;
  sessionCount: number;
  sessionIds: string[];
  /** First user prompt, used as a de facto session title */
  title?: string;
}

/**
 * Cross-agent project listing info. Used by readers that group sessions by
 * project path (Claude Code, Amp). Each agent populates `slug` in its own
 * convention (Claude: encoded path, Amp: `amp:<path>`).
 */
export interface NativeProject {
  /** Agent-specific slug used as a stable identifier */
  slug: string;
  /** Reconstructed absolute path (e.g. /Users/lu/code/foo) */
  projectPath: string;
  /** Short display name (last path component) */
  name: string;
  /** Number of sessions/threads contributing to this project */
  sessionCount: number;
  /** Most recent session modification time */
  lastModified: string;
  /** Agent sources contributing to this project (set when merged) */
  agents?: Array<{ agent: string; slug: string; sessionCount: number }>;
}

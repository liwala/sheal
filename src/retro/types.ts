import type { SessionEntry, TokenUsage, CheckpointSummary } from "../entire/types.js";

/**
 * A detected pattern where the agent retried the same approach multiple times.
 */
export interface FailureLoop {
  /** What tool or action was being retried */
  action: string;
  /** How many consecutive retries */
  retryCount: number;
  /** The entries involved in the loop */
  entries: SessionEntry[];
  /** What the error/failure looked like */
  errorPattern: string;
  /** Approximate wasted time (based on entry timestamps) */
  wastedMs?: number;
}

/**
 * A sequence of changes that were made and then reverted.
 */
export interface RevertedWork {
  /** Files that were written then overwritten or reverted */
  files: string[];
  /** How many write/edit operations were wasted */
  wastedOperations: number;
}

/**
 * Breakdown of how the session time/effort was spent.
 */
export interface EffortBreakdown {
  /** Number of each entry type */
  entryCounts: Record<string, number>;
  /** Number of each tool used */
  toolCounts: Record<string, number>;
  /** Files modified, with how many times each was touched */
  fileTouchCounts: Record<string, number>;
  /** Total user prompts */
  userPromptCount: number;
  /** Total assistant responses */
  assistantResponseCount: number;
  /** Token usage summary */
  tokenUsage?: TokenUsage;
}

/**
 * An actionable learning extracted from session analysis.
 */
export interface Learning {
  /** Short identifier */
  id: string;
  /** What category: missing-context, failure-loop, wasted-effort, environment, workflow */
  category: "missing-context" | "failure-loop" | "wasted-effort" | "environment" | "workflow";
  /** Human-readable description */
  description: string;
  /** Suggested rule or action to prevent recurrence */
  suggestion: string;
  /** Severity: how impactful was this issue */
  severity: "low" | "medium" | "high";
  /** Evidence: which entries support this learning */
  evidence?: string[];
}

/**
 * Patterns observed in the human's interaction style.
 */
export interface HumanPatterns {
  /** Estimated session duration in minutes (from first to last entry) */
  durationMinutes: number;
  /** Average time between user prompts (minutes) */
  avgPromptIntervalMinutes: number;
  /** Number of correction/redirect prompts ("no", "not that", "instead", etc.) */
  correctionCount: number;
  /** Number of very short prompts (< 20 chars, potential vagueness signal) */
  shortPromptCount: number;
  /** Number of very long prompts (> 500 chars, potential over-specification) */
  longPromptCount: number;
  /** Whether the session likely hit context limits (compaction detected) */
  contextCompacted: boolean;
  /** Ratio of user prompts to total transcript entries */
  humanEngagementRatio: number;
}

/**
 * A detected coordination issue across multiple sessions/agents.
 */
export interface CoordinationIssue {
  /** Type of coordination problem */
  type: "conflicting-edits" | "duplicated-work" | "missed-handoff";
  /** Human-readable description */
  description: string;
  /** Severity of the issue */
  severity: "low" | "medium" | "high";
  /** Sessions involved */
  sessionIds: string[];
  /** Agents involved */
  agents: string[];
  /** Files affected (if applicable) */
  files?: string[];
}

/**
 * The full retrospective report for a session.
 */
export interface Retrospective {
  /** Checkpoint ID analyzed */
  checkpointId: string;
  /** Session ID analyzed */
  sessionId: string;
  /** Agent that ran the session */
  agent?: string;
  /** When the session was created */
  createdAt: string;
  /** Entire.io's AI-generated summary (if available) */
  entireSummary?: CheckpointSummary;
  /** Effort breakdown */
  effort: EffortBreakdown;
  /** Detected failure loops */
  failureLoops: FailureLoop[];
  /** Detected reverted work */
  revertedWork: RevertedWork[];
  /** Extracted learnings */
  learnings: Learning[];
  /** Overall session health score (0-100) */
  healthScore: number;
  /** Human interaction patterns (for human-facing feedback) */
  humanPatterns?: HumanPatterns;
  /** Multi-agent coordination issues (populated when checkpoint has multiple sessions) */
  coordinationIssues?: CoordinationIssue[];
}

/**
 * Types for the session digest feature.
 *
 * A digest scans sessions across all projects and agents,
 * categorizes user prompts, counts frequency, and tracks token usage.
 */

export type DigestCategory = "SKILLS" | "AGENTS" | "SCHEDULED_TASKS" | "CLAUDE_MD";

export interface DigestItem {
  /** One-line description (first 80 chars of normalized prompt) */
  description: string;
  /** Session IDs where this prompt appeared */
  sessionIds: string[];
  /** Project names where this appeared */
  projects: string[];
  /** Agent types that ran this (claude, codex, amp, gemini) */
  agents: string[];
  /** How many times this prompt appeared */
  count: number;
  /** Assigned category */
  category: DigestCategory;
  /** ISO timestamp of most recent occurrence */
  lastSeen: string;
}

export interface TokenSummary {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate: number;
  totalApiCalls: number;
  /** Breakdown per agent */
  byAgent: Record<string, {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
    apiCalls: number;
    sessionCount: number;
  }>;
  /** Breakdown per project */
  byProject: Record<string, {
    input: number;
    output: number;
    sessionCount: number;
  }>;
  /** Breakdown per model (claude-opus-4-6, claude-sonnet-4-6, etc.) */
  byModel: Record<string, {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
    apiCalls: number;
  }>;
  /** Breakdown per project per model */
  byProjectModel: Record<string, Record<string, {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
    apiCalls: number;
  }>>;
}

export interface DigestReport {
  generatedAt: string;
  window: { since: string; until: string };
  scope: "global" | "project";
  projectFilter?: string;
  totalSessions: number;
  totalPrompts: number;
  categories: Record<DigestCategory, DigestItem[]>;
  uncategorized: DigestItem[];
  tokens: TokenSummary;
  agentScans: AgentScanStatus[];
  cost?: CostEstimate;
}

export interface RawPrompt {
  text: string;
  sessionId: string;
  project: string;
  agent: string;
  timestamp: string;
}

/** Agent scan status for graceful degradation reporting (#10) */
export interface AgentScanStatus {
  agent: string;
  available: boolean;
  projectCount: number;
  sessionCount: number;
  error?: string;
}

/** Cost estimate for a token summary */
export interface CostEstimate {
  totalCost: number;
  byAgent: Record<string, number>;
  byProject: Record<string, number>;
  /** Plan comparison — how much the subscription saves */
  planSavings?: {
    planName: string;
    planCost: number;
    apiCost: number;
    saved: number;
    savedPercent: number;
  };
}

/** Digest diff comparing two reports */
export interface DigestDiff {
  current: DigestReport;
  previous: DigestReport;
  tokenDelta: { input: number; output: number; apiCalls: number; costDelta: number };
  sessionDelta: number;
  promptDelta: number;
  categoryDeltas: Record<DigestCategory, number>;
  newItems: DigestItem[];
  droppedItems: DigestItem[];
  trendingUp: DigestItem[];
  trendingDown: DigestItem[];
}

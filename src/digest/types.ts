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
}

export interface RawPrompt {
  text: string;
  sessionId: string;
  project: string;
  agent: string;
  timestamp: string;
}

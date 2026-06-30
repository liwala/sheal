/**
 * Drift detection: compare active learnings against recent session data
 * to find patterns that should have been prevented but weren't.
 */

import type { Retrospective, Learning } from "../retro/types.js";
import type { LearningFile } from "../learn/types.js";

export interface DriftMatch {
  learning: LearningFile;
  violations: DriftViolation[];
}

export interface DriftViolation {
  sessionId: string;
  createdAt: string;
  evidence: string;
  category: "missing-context" | "failure-loop" | "wasted-effort" | "environment" | "workflow";
}

export interface DriftReport {
  /** Learnings that were violated in recent sessions */
  drifted: DriftMatch[];
  /** Learnings with no violations detected */
  healthy: LearningFile[];
  /** Sessions analyzed */
  sessionsAnalyzed: number;
}

/**
 * Keywords extracted from a learning's title and body for fuzzy matching.
 */
function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "will", "would", "could", "should", "can", "may",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "if", "or", "and", "but", "not", "no", "this", "that", "it", "its",
    "before", "after", "when", "then", "than", "each", "every", "all",
    "any", "don't", "dont", "run", "use",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
}

/**
 * Check if a retro's static learnings match an existing learning rule.
 * Uses keyword overlap as a signal that the same pattern recurred.
 */
function matchLearningToRetro(
  learning: LearningFile,
  retro: Retrospective,
): DriftViolation[] {
  const violations: DriftViolation[] = [];
  const learningKeywords = new Set(extractKeywords(`${learning.title} ${learning.body}`));
  if (learningKeywords.size === 0) return violations;

  // Check static learnings from retro analysis
  for (const retroLearning of retro.learnings) {
    const retroKeywords = extractKeywords(`${retroLearning.description} ${retroLearning.suggestion}`);
    const overlap = retroKeywords.filter((k) => learningKeywords.has(k));
    const overlapRatio = overlap.length / Math.min(learningKeywords.size, retroKeywords.length);

    if (overlapRatio >= 0.4 && overlap.length >= 3) {
      violations.push({
        sessionId: retro.sessionId,
        createdAt: retro.createdAt,
        evidence: retroLearning.description,
        category: retroLearning.category,
      });
    }
  }

  // Check failure loops — only for learnings explicitly about retries
  if (learningKeywords.has("retry") || learningKeywords.has("failing") || learningKeywords.has("twice")) {
    for (const loop of retro.failureLoops) {
      if (loop.retryCount >= 3) {
        violations.push({
          sessionId: retro.sessionId,
          createdAt: retro.createdAt,
          evidence: `Failure loop: ${loop.action} retried ${loop.retryCount}x`,
          category: "failure-loop",
        });
      }
    }
  }

  // Check reverted work — only for learnings explicitly about churn/planning
  if (learningKeywords.has("churn") || learningKeywords.has("touched") || learningKeywords.has("multi-file") || learningKeywords.has("reread")) {
    for (const revert of retro.revertedWork) {
      if (revert.wastedOperations >= 6) {
        violations.push({
          sessionId: retro.sessionId,
          createdAt: retro.createdAt,
          evidence: `File churn: ${revert.files.map((f) => f.split("/").pop()).join(", ")} (${revert.wastedOperations} wasted ops)`,
          category: "wasted-effort",
        });
      }
    }
  }

  return violations;
}

/**
 * Parse a retro enrichment file for "Recurring" section mentions.
 * These are explicit LLM-identified violations of existing learnings.
 */
export function parseRecurringFromEnrichment(content: string): Array<{ learningId: string; detail: string }> {
  const recurring: Array<{ learningId: string; detail: string }> = [];
  const recurringMatch = content.match(/\*\*Recurring:\*\*\s*([\s\S]*?)(?=\n\*\*|$)/);
  if (!recurringMatch || /^none/i.test(recurringMatch[1].trim())) return recurring;

  const text = recurringMatch[1].trim();
  // Look for LEARN-NNN references
  const idMatches = text.matchAll(/LEARN-(\d+)/g);
  for (const m of idMatches) {
    const id = `LEARN-${m[1]}`;
    // Extract surrounding context
    const idx = text.indexOf(m[0]);
    const context = text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + 100)).trim();
    recurring.push({ learningId: id, detail: context });
  }

  return recurring;
}

/**
 * Run drift detection across recent sessions.
 */
export function detectDrift(
  learnings: LearningFile[],
  retros: Retrospective[],
  enrichments?: Array<{ sessionId: string; content: string }>,
): DriftReport {
  const driftMap = new Map<string, DriftMatch>();
  const activeLearnings = learnings.filter((l) => l.status === "active");

  // Use composite key (source:id) so global/project learnings with the same ID don't collide
  const driftKey = (l: LearningFile) => `${l.source ?? "unknown"}:${l.id}`;

  // Phase 1: Static analysis matching
  for (const retro of retros) {
    for (const learning of activeLearnings) {
      const violations = matchLearningToRetro(learning, retro);
      if (violations.length > 0) {
        const key = driftKey(learning);
        const existing = driftMap.get(key);
        if (existing) {
          existing.violations.push(...violations);
        } else {
          driftMap.set(key, { learning, violations });
        }
      }
    }
  }

  // Phase 2: Parse enrichment "Recurring" sections for explicit LLM-identified drift
  if (enrichments) {
    for (const enrichment of enrichments) {
      const recurring = parseRecurringFromEnrichment(enrichment.content);
      for (const r of recurring) {
        const learning = activeLearnings.find((l) => l.id === r.learningId);
        if (!learning) continue;

        const violation: DriftViolation = {
          sessionId: enrichment.sessionId,
          createdAt: "",
          evidence: `LLM flagged: ${r.detail}`,
          category: "workflow",
        };

        const key = driftKey(learning);
        const existing = driftMap.get(key);
        if (existing) {
          existing.violations.push(violation);
        } else {
          driftMap.set(key, { learning, violations: [violation] });
        }
      }
    }
  }

  const drifted = Array.from(driftMap.values())
    .sort((a, b) => b.violations.length - a.violations.length);
  const driftedKeys = new Set(drifted.map((d) => driftKey(d.learning)));
  const healthy = activeLearnings.filter((l) => !driftedKeys.has(driftKey(l)));

  return {
    drifted,
    healthy,
    sessionsAnalyzed: retros.length,
  };
}

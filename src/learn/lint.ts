import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readLearning } from "./store.js";
import type { LearningFile } from "./types.js";

export type LintFindingType = "duplicate-id" | "near-duplicate" | "no-trigger";

export interface LintFinding {
  type: LintFindingType;
  /** Learning IDs involved in the finding */
  ids: string[];
  /** Filenames (relative to the store dir) involved in the finding */
  files: string[];
  message: string;
  /** Jaccard score for near-duplicate findings (structured, not message-scraped) */
  similarity?: number;
}

export interface LintReport {
  scanned: number;
  findings: LintFinding[];
}

/**
 * Two learnings are near-duplicates when their normalized token sets overlap
 * at or above this Jaccard similarity. Tuned against the real corpus (the
 * "inspect real data before parsing" variants score ~0.44).
 */
const NEAR_DUPLICATE_THRESHOLD = 0.4;

/**
 * A learning without any conditional phrasing has no checkable trigger — an
 * agent can't tell when it applies. Lexical heuristic, not semantic judgment.
 */
const TRIGGER_PATTERN = /\b(when|whenever|before|after|if|once|upon|during)\b/i;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "is",
  "are",
  "do",
  "not",
  "it",
  "this",
  "that",
  "with",
  "on",
  "be",
  "any",
  "all",
  "you",
  "your",
  "was",
  "were",
  "has",
  "have",
  "had",
]);

interface Entry {
  file: string;
  learning: LearningFile;
}

function tokenSet(learning: LearningFile): Set<string> {
  const text = `${learning.title} ${learning.body}`.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = text
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    // light plural folding so "samples"/"sample" count as the same token
    .map((t) => t.replace(/s$/, ""));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function findDuplicateIds(entries: Entry[]): LintFinding[] {
  const byId = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = byId.get(entry.learning.id) ?? [];
    group.push(entry);
    byId.set(entry.learning.id, group);
  }

  const findings: LintFinding[] = [];
  for (const [id, group] of byId) {
    if (group.length > 1) {
      const files = group.map((e) => e.file).sort();
      findings.push({
        type: "duplicate-id",
        ids: [id],
        files,
        message: `${id} exists in ${group.length} files: ${files.join(", ")}`,
      });
    }
  }
  return findings;
}

function findNearDuplicates(entries: Entry[]): LintFinding[] {
  const tokens = entries.map((e) => tokenSet(e.learning));
  const findings: LintFinding[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      // same-ID pairs are already reported as duplicate-id findings
      if (entries[i].learning.id === entries[j].learning.id) continue;
      const similarity = jaccard(tokens[i], tokens[j]);
      if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
        findings.push({
          type: "near-duplicate",
          ids: [entries[i].learning.id, entries[j].learning.id],
          files: [entries[i].file, entries[j].file],
          message: `${entries[i].learning.id} and ${entries[j].learning.id} say nearly the same thing (similarity ${similarity.toFixed(2)}) — merge or retire one`,
          similarity: Number(similarity.toFixed(2)),
        });
      }
    }
  }
  return findings;
}

function findMissingTriggers(entries: Entry[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const entry of entries) {
    const text = `${entry.learning.title} ${entry.learning.body}`;
    if (!TRIGGER_PATTERN.test(text)) {
      findings.push({
        type: "no-trigger",
        ids: [entry.learning.id],
        files: [entry.file],
        message: `${entry.learning.id} has no checkable trigger condition — rewrite as "when X, do Y" or retire`,
      });
    }
  }
  return findings;
}

/**
 * Lint a learnings store directory for corpus hygiene problems:
 * duplicate IDs, near-duplicate rules, and learnings with no trigger.
 */
export function lintLearnings(dir: string): LintReport {
  if (!existsSync(dir)) return { scanned: 0, findings: [] };

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"))
    .sort();
  const entries: Entry[] = files.map((file) => ({
    file,
    learning: readLearning(join(dir, file)),
  }));

  // Superseded/retired learnings are already resolved: they keep their ID
  // (collisions still matter) but no longer compete as live rules.
  const live = entries.filter((e) => e.learning.status !== "superseded" && e.learning.status !== "retired");

  return {
    scanned: entries.length,
    findings: [...findDuplicateIds(entries), ...findNearDuplicates(live), ...findMissingTriggers(live)],
  };
}

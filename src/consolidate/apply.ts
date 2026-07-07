import { existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLearning, renderLearning, slugify } from "../learn/store.js";
import type { LearningFile } from "../learn/types.js";

/**
 * The apply stage of an ADR 0001 consolidation pass: execute reviewed
 * dispositions against the store. The change set (T13) is a proposal;
 * a decisions file is the human-reviewed outcome; this applies it.
 *
 * Dry-run unless opts.apply is true — the store is never mutated without
 * an affirmative flag, matching `sheal consolidate`'s store-untouched
 * contract.
 */
export type Decision =
  | { action: "renumber"; file: string; toId: string }
  | { action: "supersede"; file: string; by: string }
  | { action: "retire"; file: string; reason: string }
  | { action: "rewrite"; file: string; title: string; body: string };

export interface DecisionsFile {
  decisions: Decision[];
}

export interface PlannedChange {
  action: Decision["action"];
  file: string;
  detail: string;
}

export interface ApplyResult {
  applied: boolean;
  planned: PlannedChange[];
}

interface ValidatedDecision {
  decision: Decision;
  learning: LearningFile;
  path: string;
}

function validate(dir: string, decisionsFile: DecisionsFile): ValidatedDecision[] {
  const actions = new Set(["renumber", "supersede", "retire", "rewrite"]);
  const existingIds = new Map<string, string[]>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"))) {
      const l = readLearning(join(dir, f));
      existingIds.set(l.id, [...(existingIds.get(l.id) ?? []), f]);
    }
  }

  return decisionsFile.decisions.map((decision) => {
    if (!actions.has(decision.action)) {
      throw new Error(`Unknown action "${(decision as { action: string }).action}" in decisions file`);
    }
    if (!decision.file) {
      throw new Error(`Decision (${decision.action}) is missing a "file" reference`);
    }
    const path = join(dir, decision.file);
    if (!existsSync(path)) {
      throw new Error(`Decision references a missing file: ${decision.file}`);
    }
    const learning = readLearning(path);

    if (decision.action === "renumber") {
      if (!/^LEARN-\d+$/.test(decision.toId)) {
        throw new Error(`Renumber target for ${decision.file} is not a LEARN-NNN id: "${decision.toId}"`);
      }
      const holders = (existingIds.get(decision.toId) ?? []).filter((f) => f !== decision.file);
      if (holders.length > 0) {
        throw new Error(`Renumber target ${decision.toId} is already used by ${holders.join(", ")}`);
      }
    }
    if (decision.action === "supersede" && !decision.by) {
      throw new Error(`Supersede decision for ${decision.file} is missing "by"`);
    }
    if (decision.action === "retire" && !decision.reason) {
      throw new Error(`Retire decision for ${decision.file} is missing "reason"`);
    }
    if (decision.action === "rewrite" && (!decision.title || !decision.body)) {
      throw new Error(`Rewrite decision for ${decision.file} needs both "title" and "body"`);
    }
    return { decision, learning, path };
  });
}

function planDetail(v: ValidatedDecision): string {
  const d = v.decision;
  switch (d.action) {
    case "renumber":
      return `${v.learning.id} → ${d.toId}`;
    case "supersede":
      return `superseded by ${d.by}`;
    case "retire":
      return `retired: ${d.reason}`;
    case "rewrite":
      return `rewrite: "${d.title}"`;
  }
}

function execute(dir: string, v: ValidatedDecision): void {
  const d = v.decision;
  // Re-read at execution time: decisions apply in file order, and an earlier
  // decision (e.g. supersede) may already have rewritten this file. Status
  // changes must be listed before a renumber of the same file — the renumber
  // renames it, so later decisions could no longer find it by the old name.
  const current = readLearning(v.path);
  switch (d.action) {
    case "renumber": {
      const updated = { ...current, id: d.toId };
      const newPath = join(dir, `${d.toId}-${slugify(updated.title)}.md`);
      writeFileSync(newPath, renderLearning(updated), "utf-8");
      if (newPath !== v.path) unlinkSync(v.path);
      break;
    }
    case "supersede": {
      const updated: LearningFile = {
        ...current,
        status: "superseded",
        body: `${current.body.trim()}\n\n**Superseded by:** ${d.by}`,
      };
      writeFileSync(v.path, renderLearning(updated), "utf-8");
      break;
    }
    case "retire": {
      const updated: LearningFile = {
        ...current,
        status: "retired",
        body: `${current.body.trim()}\n\n**Retired:** ${d.reason}`,
      };
      writeFileSync(v.path, renderLearning(updated), "utf-8");
      break;
    }
    case "rewrite": {
      const updated: LearningFile = { ...current, title: d.title, body: d.body };
      const newPath = join(dir, `${updated.id}-${slugify(d.title)}.md`);
      writeFileSync(newPath, renderLearning(updated), "utf-8");
      if (newPath !== v.path) unlinkSync(v.path);
      break;
    }
  }
}

/**
 * Validate every decision against the store, then (only with apply=true)
 * execute them. Validation failures throw before anything is written, so
 * a bad decisions file never leaves the store half-changed.
 */
export function applyDecisions(
  dir: string,
  decisionsFile: DecisionsFile,
  opts: { apply: boolean },
): ApplyResult {
  const validated = validate(dir, decisionsFile);
  const planned = validated.map((v) => ({
    action: v.decision.action,
    file: v.decision.file,
    detail: planDetail(v),
  }));

  if (!opts.apply) return { applied: false, planned };

  for (const v of validated) execute(dir, v);
  return { applied: true, planned };
}

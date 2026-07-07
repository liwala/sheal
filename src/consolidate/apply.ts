import { existsSync, lstatSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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

/**
 * In-place writes follow symlinks, so a LEARN-*.md symlink inside the store
 * would redirect a supersede/retire write outside it. Refuse symlinks at
 * every path we read or write.
 */
function assertNotSymlink(path: string, label: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} is a symlink — refusing to read or write through it: ${path}`);
  }
}

function validate(dir: string, decisionsFile: DecisionsFile): ValidatedDecision[] {
  const actions = new Set(["renumber", "supersede", "retire", "rewrite"]);
  const existingIds = new Map<string, string[]>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"))) {
      // Symlinks are never legitimate store entries; skip them here so the
      // scan doesn't read through them — decisions referencing one are
      // rejected below by assertNotSymlink.
      if (lstatSync(join(dir, f)).isSymbolicLink()) continue;
      const l = readLearning(join(dir, f));
      existingIds.set(l.id, [...(existingIds.get(l.id) ?? []), f]);
    }
  }

  // Walk decisions in order, simulating renames: a renumber/rewrite renames
  // its file, so later decisions can no longer reference the old name, and
  // two renumbers must not claim the same target id.
  const renamedAway = new Set<string>();
  const claimedIds = new Set<string>();

  return decisionsFile.decisions.map((decision) => {
    if (!actions.has(decision.action)) {
      throw new Error(`Unknown action "${(decision as { action: string }).action}" in decisions file`);
    }
    if (!decision.file) {
      throw new Error(`Decision (${decision.action}) is missing a "file" reference`);
    }
    // Plain store filenames only — "file" is joined onto the store dir, so a
    // path with separators could read or write outside the store.
    if (decision.file.includes("/") || decision.file.includes("\\") || !decision.file.startsWith("LEARN-")) {
      throw new Error(`Decision file must be a LEARN-*.md filename inside the store, got: ${decision.file}`);
    }
    if (renamedAway.has(decision.file)) {
      throw new Error(
        `Decision references ${decision.file}, which an earlier renumber/rewrite renames — list status changes before renames`,
      );
    }
    const path = join(dir, decision.file);
    if (!existsSync(path)) {
      throw new Error(`Decision references a missing file: ${decision.file}`);
    }
    assertNotSymlink(path, `Decision file ${decision.file}`);
    const learning = readLearning(path);

    if (decision.action === "renumber") {
      if (!/^LEARN-\d{3,}$/.test(decision.toId)) {
        throw new Error(`Renumber target for ${decision.file} is not a zero-padded LEARN-NNN id: "${decision.toId}"`);
      }
      assertNotSymlink(join(dir, `${decision.toId}-${slugify(learning.title)}.md`), `Renumber target for ${decision.toId}`);
      const holders = (existingIds.get(decision.toId) ?? []).filter((f) => f !== decision.file);
      if (holders.length > 0) {
        throw new Error(`Renumber target ${decision.toId} is already used by ${holders.join(", ")}`);
      }
      if (claimedIds.has(decision.toId)) {
        throw new Error(`Renumber target ${decision.toId} is already claimed by an earlier decision in this file`);
      }
      claimedIds.add(decision.toId);
    }
    if (decision.action === "renumber" || decision.action === "rewrite") {
      renamedAway.add(decision.file);
    }
    if (decision.action === "supersede" && !decision.by) {
      throw new Error(`Supersede decision for ${decision.file} is missing "by"`);
    }
    if (decision.action === "retire" && !decision.reason) {
      throw new Error(`Retire decision for ${decision.file} is missing "reason"`);
    }
    if (decision.action === "rewrite") {
      if (!decision.title || !decision.body) {
        throw new Error(`Rewrite decision for ${decision.file} needs both "title" and "body"`);
      }
      if (/[\r\n]/.test(decision.title)) {
        throw new Error(`Rewrite title for ${decision.file} must be a single line (frontmatter injection)`);
      }
      assertNotSymlink(join(dir, `${learning.id}-${slugify(decision.title)}.md`), `Rewrite target for ${decision.file}`);
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
  assertNotSymlink(v.path, `Decision file ${d.file}`);
  const current = readLearning(v.path);
  switch (d.action) {
    case "renumber": {
      const updated = { ...current, id: d.toId };
      const newPath = join(dir, `${d.toId}-${slugify(updated.title)}.md`);
      assertNotSymlink(newPath, `Renumber target for ${d.toId}`);
      writeFileSync(newPath, renderLearning(updated), "utf-8");
      if (newPath !== v.path) unlinkSync(v.path);
      break;
    }
    case "supersede": {
      // Idempotent: re-applying the same decision must not stack pointers
      if (current.status === "superseded" && current.body.includes(`**Superseded by:** ${d.by}`)) break;
      const updated: LearningFile = {
        ...current,
        status: "superseded",
        body: `${current.body.trim()}\n\n**Superseded by:** ${d.by}`,
      };
      writeFileSync(v.path, renderLearning(updated), "utf-8");
      break;
    }
    case "retire": {
      if (current.status === "retired" && current.body.includes(`**Retired:** ${d.reason}`)) break;
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
      assertNotSymlink(newPath, `Rewrite target for ${d.file}`);
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

import { mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  getGlobalDir,
  getProjectDir,
  nextId,
  slugify,
  writeLearning,
  listLearnings,
  detectProjectTags,
} from "../learn/index.js";
import type { LearningCategory, LearningSeverity, LearningFile } from "../learn/types.js";

interface LearnAddOptions {
  insight: string;
  tags: string[];
  category: LearningCategory;
  severity: LearningSeverity;
  projectRoot: string;
}

/**
 * `sheal learn add "insight" --tags=x,y --category=workflow --severity=medium`
 * Writes a new learning to the global directory.
 */
export async function runLearnAdd(opts: LearnAddOptions): Promise<void> {
  const globalDir = getGlobalDir();
  const id = nextId(globalDir);
  const today = new Date().toISOString().slice(0, 10);

  const learning: LearningFile = {
    id,
    title: opts.insight.slice(0, 80),
    date: today,
    tags: opts.tags.length > 0 ? opts.tags : ["general"],
    category: opts.category,
    severity: opts.severity,
    status: "active",
    body: opts.insight,
  };

  const filepath = writeLearning(globalDir, learning);
  console.log(`Created ${id}: ${filepath}`);
}

interface LearnListOptions {
  global: boolean;
  tag?: string;
  projectRoot: string;
}

/**
 * `sheal learn list [--global] [--tag=x]`
 * Lists learnings from project or global directory.
 */
export async function runLearnList(opts: LearnListOptions): Promise<void> {
  const dir = opts.global ? getGlobalDir() : getProjectDir(opts.projectRoot);
  const learnings = listLearnings(dir);

  if (learnings.length === 0) {
    const scope = opts.global ? "global" : "project";
    console.log(`No learnings found in ${scope} directory (${dir})`);
    return;
  }

  let filtered = learnings;
  if (opts.tag) {
    filtered = learnings.filter((l) => l.tags.includes(opts.tag!));
  }

  if (filtered.length === 0) {
    console.log(`No learnings match tag "${opts.tag}"`);
    return;
  }

  for (const l of filtered) {
    const tags = l.tags.join(", ");
    console.log(`${l.id}  [${l.severity}] [${tags}]  ${l.title}`);
  }
  console.log(`\n${filtered.length} learning(s)`);
}

interface LearnSyncOptions {
  projectRoot: string;
}

/**
 * `sheal learn sync`
 * Detect project tags, filter global learnings by tag overlap, copy to .sheal/learnings/.
 */
export async function runLearnSync(opts: LearnSyncOptions): Promise<void> {
  const globalDir = getGlobalDir();
  const projectDir = getProjectDir(opts.projectRoot);
  const projectTags = detectProjectTags(opts.projectRoot);

  console.log(`Project tags: ${projectTags.join(", ")}`);

  const globalLearnings = listLearnings(globalDir);
  if (globalLearnings.length === 0) {
    console.log("No global learnings to sync.");
    return;
  }

  // Filter by tag overlap
  const matching = globalLearnings.filter((l) =>
    l.tags.some((t) => projectTags.includes(t))
  );

  if (matching.length === 0) {
    console.log("No global learnings match this project's tags.");
    return;
  }

  // Copy matching files to project dir
  mkdirSync(projectDir, { recursive: true });

  let copied = 0;
  const globalFiles = readdirSync(globalDir).filter(
    (f) => f.startsWith("LEARN-") && f.endsWith(".md")
  );

  for (const learning of matching) {
    // Find the actual filename for this learning
    const filename = globalFiles.find((f) => f.startsWith(learning.id));
    if (!filename) continue;

    const src = join(globalDir, filename);
    const dest = join(projectDir, filename);

    // Only copy if source exists (defensive)
    if (existsSync(src)) {
      copyFileSync(src, dest);
      copied++;
    }
  }

  console.log(`Synced ${copied}/${globalLearnings.length} learnings to ${projectDir}`);
}

import { mkdirSync, copyFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import {
  getGlobalDir,
  getProjectDir,
  nextId,
  slugify,
  writeLearning,
  listLearnings,
  detectProjectTags,
} from "../learn/index.js";
import { reviewExistingLearnings } from "../learn/review.js";
import type { LearningCategory, LearningSeverity, LearningFile } from "../learn/types.js";

interface LearnAddOptions {
  insight: string;
  tags: string[];
  category: LearningCategory;
  severity: LearningSeverity;
  projectRoot: string;
  global?: boolean;
}

/**
 * `sheal learn add "insight" --tags=x,y --category=workflow --severity=medium`
 * Writes a new learning to the project directory by default, or global with --global.
 */
export async function runLearnAdd(opts: LearnAddOptions): Promise<void> {
  const dir = opts.global ? getGlobalDir() : getProjectDir(opts.projectRoot);
  mkdirSync(dir, { recursive: true });
  const id = nextId(dir);
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

  const filepath = writeLearning(dir, learning);
  const scope = opts.global ? "global" : "project";
  console.log(`Created ${id} (${scope}): ${filepath}`);
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

  const drafts = filtered.filter((l) => l.status === "draft");
  const active = filtered.filter((l) => l.status !== "draft");

  for (const l of filtered) {
    const tags = l.tags.join(", ");
    const draftBadge = l.status === "draft" ? chalk.yellow("[draft] ") : "";
    console.log(`${l.id}  ${draftBadge}[${l.severity}] [${tags}]  ${l.title}`);
  }
  console.log(`\n${filtered.length} learning(s)${drafts.length > 0 ? chalk.yellow(` (${drafts.length} draft)`) : ""}`);
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

    // Skip if already synced with same content
    if (existsSync(dest) && readFileSync(src, "utf8") === readFileSync(dest, "utf8")) {
      continue;
    }

    if (existsSync(src)) {
      copyFileSync(src, dest);
      copied++;
    }
  }

  console.log(`Synced ${copied}/${globalLearnings.length} learnings to ${projectDir}`);
}

interface LearnPromoteOptions {
  projectRoot: string;
}

/**
 * `sheal learn promote`
 * Interactively select project learnings to copy to the global directory.
 */
export async function runLearnPromote(opts: LearnPromoteOptions): Promise<void> {
  const projectDir = getProjectDir(opts.projectRoot);
  const globalDir = getGlobalDir();
  const learnings = listLearnings(projectDir).filter((l) => l.status === "active");

  if (learnings.length === 0) {
    console.log(chalk.yellow("No active project learnings to promote."));
    console.log(chalk.gray("Add learnings with: sheal learn add \"insight\""));
    return;
  }

  // Check which are already in global (by title match)
  const globalLearnings = listLearnings(globalDir);
  const globalTitles = new Set(globalLearnings.map((l) => l.title));

  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log();
  console.log(chalk.bold(`Promote project learnings to global (~/.sheal/learnings/)`));
  console.log(chalk.gray(`${learnings.length} active learning(s) in project\n`));

  let promoted = 0;

  try {
    for (let i = 0; i < learnings.length; i++) {
      const l = learnings[i];
      const alreadyGlobal = globalTitles.has(l.title);

      console.log(chalk.bold(`[${i + 1}/${learnings.length}] ${l.id}`));
      console.log(chalk.cyan(`  ${l.title}`));
      if (alreadyGlobal) {
        console.log(chalk.gray("  (already exists in global)"));
      }
      console.log(chalk.gray(`  tags: ${l.tags.join(", ")}  severity: ${l.severity}`));

      const answer = await ask(chalk.white(`  Promote to global? [${alreadyGlobal ? "y/N" : "Y/n"}] `));
      const a = answer.trim().toLowerCase();

      if (a === "q") {
        console.log(chalk.gray("  Stopping."));
        break;
      }

      const shouldPromote = alreadyGlobal
        ? (a === "y" || a === "yes")
        : (a === "" || a === "y" || a === "yes");

      if (shouldPromote) {
        const id = nextId(globalDir);
        const globalLearning = { ...l, id };
        writeLearning(globalDir, globalLearning);
        promoted++;
        console.log(chalk.green(`  ✓ Promoted as ${id}`));
      } else {
        console.log(chalk.gray("  — Skipped"));
      }
    }
  } finally {
    rl.close();
  }

  if (promoted > 0) {
    console.log(chalk.green(`\nPromoted ${promoted} learning(s) to global. Run 'sheal learn list --global' to view.`));
  }
}

interface LearnReviewOptions {
  global: boolean;
  projectRoot: string;
}

/**
 * `sheal learn review [--global]`
 * Interactively review learnings: accept, edit, remove, or skip each one.
 */
export async function runLearnReview(opts: LearnReviewOptions): Promise<void> {
  const dir = opts.global ? getGlobalDir() : getProjectDir(opts.projectRoot);
  const learnings = listLearnings(dir);

  if (learnings.length === 0) {
    const scope = opts.global ? "global" : "project";
    console.log(chalk.yellow(`No learnings found in ${scope} directory (${dir})`));
    return;
  }

  // Build filename list matching the learnings
  const allFiles = readdirSync(dir)
    .filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"))
    .sort();

  const filenames = learnings.map((l) => {
    return allFiles.find((f) => f.startsWith(l.id)) || "";
  });

  const result = await reviewExistingLearnings(learnings, dir, filenames);

  console.log();
  console.log(chalk.bold("Review complete:"));
  const parts = [];
  if (result.promoted > 0) parts.push(chalk.green(`${result.promoted} promoted`));
  if (result.kept > 0) parts.push(chalk.green(`${result.kept} kept`));
  if (result.edited > 0) parts.push(chalk.cyan(`${result.edited} edited`));
  if (result.removed > 0) parts.push(chalk.red(`${result.removed} removed`));
  if (result.remaining > 0) parts.push(chalk.yellow(`${result.remaining} drafts remaining`));
  console.log(`  ${parts.join("  ")}`);

  if (result.remaining > 0) {
    console.log(chalk.gray(`\nRun 'sheal learn review${opts.global ? " --global" : ""}' again to continue.`));
  }
}

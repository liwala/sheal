import { createInterface } from "node:readline";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { LearningFile } from "./types.js";

export interface ReviewResult {
  action: "accept" | "edit" | "skip" | "remove" | "quit";
  /** Updated text (only set when action is "edit") */
  editedText?: string;
}

/**
 * Interactive readline-based review of a single learning.
 * Returns the user's chosen action.
 */
export async function reviewLearning(
  learning: LearningFile,
  index: number,
  total: number,
  rl: ReturnType<typeof createInterface>,
): Promise<ReviewResult> {
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log();
  console.log(chalk.bold(`[${index + 1}/${total}] ${learning.id}`));
  console.log(chalk.cyan(`  ${learning.title}`));
  if (learning.body !== learning.title) {
    // Show body if it differs from title (truncated)
    const bodyPreview = learning.body.split("\n").slice(0, 3).join("\n  ");
    console.log(chalk.gray(`  ${bodyPreview}`));
  }
  console.log(chalk.gray(`  tags: ${learning.tags.join(", ")}  severity: ${learning.severity}  category: ${learning.category}`));

  const answer = await ask(chalk.white("  [a]ccept  [e]dit  [s]kip  [r]emove  [q]uit → "));
  const a = answer.trim().toLowerCase();

  if (a === "q" || a === "quit") return { action: "quit" };
  if (a === "r" || a === "remove") return { action: "remove" };
  if (a === "s" || a === "skip" || a === "n") return { action: "skip" };

  if (a === "e" || a === "edit") {
    console.log(chalk.gray("  Enter new text (press enter to confirm):"));
    const newText = await ask(chalk.white("  > "));
    if (newText.trim()) {
      return { action: "edit", editedText: newText.trim() };
    }
    // Empty edit = accept as-is
    return { action: "accept" };
  }

  // Default: accept (a, y, yes, empty)
  return { action: "accept" };
}

/**
 * Review a list of proposed learnings (not yet saved).
 * Returns only the accepted/edited learnings.
 */
export async function reviewProposedLearnings(
  learnings: LearningFile[],
): Promise<LearningFile[]> {
  if (learnings.length === 0) return [];

  console.log();
  console.log(chalk.bold(`Review ${learnings.length} proposed learning(s)`));
  console.log(chalk.gray("Each learning will be saved to ~/.sheal/learnings/ if accepted\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const accepted: LearningFile[] = [];

  try {
    for (let i = 0; i < learnings.length; i++) {
      const result = await reviewLearning(learnings[i], i, learnings.length, rl);

      switch (result.action) {
        case "accept":
          accepted.push(learnings[i]);
          console.log(chalk.green("  ✓ Accepted"));
          break;
        case "edit":
          accepted.push({
            ...learnings[i],
            title: result.editedText!.slice(0, 80),
            body: result.editedText!,
          });
          console.log(chalk.green("  ✓ Accepted (edited)"));
          break;
        case "skip":
          console.log(chalk.gray("  — Skipped"));
          break;
        case "remove":
          console.log(chalk.gray("  — Skipped"));
          break;
        case "quit":
          console.log(chalk.gray("  Stopping review."));
          return accepted;
      }
    }
  } finally {
    rl.close();
  }

  return accepted;
}

/**
 * Review existing learnings on disk.
 * Supports accept (keep), edit, remove, skip, quit.
 * Returns counts of actions taken.
 */
export async function reviewExistingLearnings(
  learnings: LearningFile[],
  dir: string,
  filenames: string[],
): Promise<{ kept: number; edited: number; removed: number }> {
  if (learnings.length === 0) {
    console.log(chalk.yellow("No learnings to review."));
    return { kept: 0, edited: 0, removed: 0 };
  }

  console.log();
  console.log(chalk.bold(`Reviewing ${learnings.length} learning(s) in ${dir}`));
  console.log(chalk.gray("Actions: [a]ccept (keep)  [e]dit  [s]kip  [r]emove  [q]uit\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let kept = 0;
  let edited = 0;
  let removed = 0;

  try {
    for (let i = 0; i < learnings.length; i++) {
      const result = await reviewLearning(learnings[i], i, learnings.length, rl);
      const filename = filenames[i];

      switch (result.action) {
        case "accept":
          kept++;
          console.log(chalk.green("  ✓ Kept"));
          break;
        case "edit": {
          // Rewrite the file with updated text
          const { writeLearning } = await import("./store.js");
          const updated: LearningFile = {
            ...learnings[i],
            title: result.editedText!.slice(0, 80),
            body: result.editedText!,
          };
          // Remove old file first, then write updated
          try { unlinkSync(join(dir, filename)); } catch { /* ignore */ }
          writeLearning(dir, updated);
          edited++;
          console.log(chalk.green("  ✓ Updated"));
          break;
        }
        case "remove":
          try {
            unlinkSync(join(dir, filename));
            removed++;
            console.log(chalk.red("  ✗ Removed"));
          } catch {
            console.log(chalk.red("  ✗ Failed to remove"));
          }
          break;
        case "skip":
          kept++;
          console.log(chalk.gray("  — Skipped (kept)"));
          break;
        case "quit":
          console.log(chalk.gray("  Stopping review."));
          return { kept, edited, removed };
      }
    }
  } finally {
    rl.close();
  }

  return { kept, edited, removed };
}

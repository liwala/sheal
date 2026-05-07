import { createInterface } from "node:readline";
import { unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { LearningFile } from "./types.js";
import { listLearnings, writeLearning } from "./store.js";

/**
 * Like readline.question(), but returns null if ESC is pressed.
 */
function askWithEsc(prompt: string, rl: ReturnType<typeof createInterface>): Promise<string | null> {
  return new Promise((resolve) => {
    const onKeypress = (_: string, key: { name?: string; sequence?: string }) => {
      if (key?.name === "escape" || key?.sequence === "\x1b") {
        process.stdin.removeListener("keypress", onKeypress);
        // Clear the current line and resolve null
        rl.write(null, { ctrl: true, name: "u" }); // clear input
        process.stdout.write("\n");
        resolve(null);
      }
    };

    if (process.stdin.isTTY) {
      const { emitKeypressEvents } = require("node:readline");
      emitKeypressEvents(process.stdin);
      process.stdin.on("keypress", onKeypress);
    }

    rl.question(prompt, (answer) => {
      process.stdin.removeListener("keypress", onKeypress);
      resolve(answer);
    });
  });
}

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
  if (a === "r" || a === "remove") {
    const confirm = await ask(chalk.red(`  Delete ${learning.id}? [y/N] `));
    if (confirm.trim().toLowerCase() === "y") return { action: "remove" };
    console.log(chalk.gray("  Not deleted."));
    return { action: "skip" };
  }
  if (a === "s" || a === "skip" || a === "n") return { action: "skip" };

  if (a === "e" || a === "edit") {
    console.log(chalk.gray("  Enter new text (enter to confirm, ESC to cancel):"));
    const newText = await askWithEsc(chalk.white("  > "), rl);
    if (newText === null) {
      console.log(chalk.gray("  Edit cancelled."));
      return { action: "skip" };
    }
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
 * Find the filename for a learning in a directory.
 */
function findFilename(dir: string, learningId: string): string {
  const files = readdirSync(dir).filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"));
  return files.find((f) => f.startsWith(learningId)) || "";
}

/**
 * Apply a review action to a learning file on disk.
 * For drafts, "accept" promotes to active. For active learnings, "accept" keeps as-is.
 */
function applyAction(
  learning: LearningFile,
  result: ReviewResult,
  dir: string,
  filename: string,
): "kept" | "promoted" | "edited" | "removed" | "skipped" {
  switch (result.action) {
    case "accept": {
      if (learning.status === "draft") {
        // Promote draft to active
        const updated = { ...learning, status: "active" as const };
        try { unlinkSync(join(dir, filename)); } catch { /* ignore */ }
        writeLearning(dir, updated);
        return "promoted";
      }
      return "kept";
    }
    case "edit": {
      const status = learning.status === "draft" ? "active" as const : learning.status;
      const updated: LearningFile = {
        ...learning,
        title: result.editedText!.slice(0, 80),
        body: result.editedText!,
        status,
      };
      try { unlinkSync(join(dir, filename)); } catch { /* ignore */ }
      writeLearning(dir, updated);
      return "edited";
    }
    case "remove": {
      try { unlinkSync(join(dir, filename)); } catch { /* ignore */ }
      return "removed";
    }
    case "skip":
      return "skipped";
    default:
      return "skipped";
  }
}

/**
 * Review existing learnings on disk.
 * Drafts are shown first. Accepting a draft promotes it to active.
 * Returns counts of actions taken.
 */
export async function reviewExistingLearnings(
  learnings: LearningFile[],
  dir: string,
  filenames: string[],
): Promise<{ kept: number; promoted: number; edited: number; removed: number; remaining: number }> {
  if (learnings.length === 0) {
    console.log(chalk.yellow("No learnings to review."));
    return { kept: 0, promoted: 0, edited: 0, removed: 0, remaining: 0 };
  }

  // Sort: drafts first, then by ID
  const indexed = learnings.map((l, i) => ({ learning: l, filename: filenames[i] }));
  indexed.sort((a, b) => {
    if (a.learning.status === "draft" && b.learning.status !== "draft") return -1;
    if (a.learning.status !== "draft" && b.learning.status === "draft") return 1;
    return a.learning.id.localeCompare(b.learning.id);
  });

  const draftCount = indexed.filter((x) => x.learning.status === "draft").length;
  const activeCount = indexed.length - draftCount;

  console.log();
  console.log(chalk.bold(`Reviewing ${indexed.length} learning(s) in ${dir}`));
  if (draftCount > 0) {
    console.log(chalk.yellow(`  ${draftCount} draft(s) pending review`) + (activeCount > 0 ? chalk.gray(`, ${activeCount} active`) : ""));
  }
  console.log(chalk.gray("Actions: [a]ccept  [e]dit  [s]kip  [r]emove  [q]uit\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let kept = 0;
  let promoted = 0;
  let edited = 0;
  let removed = 0;

  try {
    for (let i = 0; i < indexed.length; i++) {
      const { learning, filename } = indexed[i];
      const isDraft = learning.status === "draft";

      // Show draft badge
      if (isDraft) {
        process.stdout.write(chalk.yellow("  [DRAFT] "));
      }

      const result = await reviewLearning(learning, i, indexed.length, rl);

      if (result.action === "quit") {
        console.log(chalk.gray("  Stopping review."));
        // Count remaining drafts
        const remaining = indexed.slice(i).filter((x) => x.learning.status === "draft").length;
        return { kept, promoted, edited, removed, remaining };
      }

      const outcome = applyAction(learning, result, dir, filename);
      switch (outcome) {
        case "promoted":
          promoted++;
          console.log(chalk.green("  ✓ Accepted (promoted to active)"));
          break;
        case "kept":
          kept++;
          console.log(chalk.green("  ✓ Kept"));
          break;
        case "edited":
          edited++;
          console.log(chalk.green(`  ✓ Updated${isDraft ? " (promoted to active)" : ""}`));
          break;
        case "removed":
          removed++;
          console.log(chalk.red("  ✗ Removed"));
          break;
        case "skipped":
          console.log(chalk.gray(isDraft ? "  — Skipped (remains draft)" : "  — Skipped (kept)"));
          break;
      }
    }
  } finally {
    rl.close();
  }

  return { kept, promoted, edited, removed, remaining: 0 };
}

/**
 * Review only draft learnings in a directory.
 * Convenience wrapper for the retro --enrich flow.
 */
export async function reviewDraftLearnings(
  dir: string,
): Promise<{ promoted: number; edited: number; removed: number; remaining: number }> {
  const allLearnings = listLearnings(dir);
  const allFiles = readdirSync(dir).filter((f) => f.startsWith("LEARN-") && f.endsWith(".md")).sort();

  const drafts = allLearnings.filter((l) => l.status === "draft");
  if (drafts.length === 0) {
    console.log(chalk.gray("No draft learnings to review."));
    return { promoted: 0, edited: 0, removed: 0, remaining: 0 };
  }

  const filenames = drafts.map((l) => allFiles.find((f) => f.startsWith(l.id)) || "");

  const result = await reviewExistingLearnings(drafts, dir, filenames);
  return {
    promoted: result.promoted,
    edited: result.edited,
    removed: result.removed,
    remaining: result.remaining,
  };
}

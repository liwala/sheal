import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { exec } from "../utils/exec.js";
import { startTimer } from "../utils/timer.js";

export const gitChecker: Checker = {
  name: "git",
  label: "Git Status",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const details: CheckDetail[] = [];
    const cwd = ctx.projectRoot;

    // Check if inside a git repo
    const isRepo = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    if (isRepo.exitCode !== 0) {
      return {
        name: this.name, label: this.label, severity: "skip",
        details: [{ message: "Not a git repository", severity: "skip" }],
        durationMs: elapsed(),
      };
    }

    // Current branch
    const branch = await exec("git", ["branch", "--show-current"], { cwd });
    const branchName = branch.stdout.trim() || "detached HEAD";
    details.push({
      message: `On branch: ${branchName}`,
      severity: "pass",
      data: { branch: branchName },
    });

    // Uncommitted changes
    const status = await exec("git", ["status", "--porcelain"], { cwd });
    const lines = status.stdout.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      const staged = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;
      const unstaged = lines.filter((l) => l[1] === "M" || l[1] === "D").length;
      const untracked = lines.filter((l) => l.startsWith("??")).length;

      const severity = ctx.config.checkers.git.allowDirty ? "warn" : "warn";
      details.push({
        message: `Uncommitted changes: ${staged} staged, ${unstaged} unstaged, ${untracked} untracked`,
        severity,
        data: { staged, unstaged, untracked, totalChanged: lines.length },
      });
    } else {
      details.push({ message: "Working tree clean", severity: "pass" });
    }

    // Merge conflicts
    const conflicts = await exec("git", ["diff", "--check"], { cwd });
    if (conflicts.exitCode !== 0 && conflicts.stdout.includes("conflict")) {
      details.push({
        message: "Merge conflict markers detected",
        severity: "fail",
        data: { raw: conflicts.stdout.slice(0, 500) },
      });
    }

    const worst = worstSeverity(details);
    return { name: this.name, label: this.label, severity: worst, details, durationMs: elapsed() };
  },
};

function worstSeverity(details: CheckDetail[]): CheckResult["severity"] {
  if (details.some((d) => d.severity === "fail")) return "fail";
  if (details.some((d) => d.severity === "warn")) return "warn";
  if (details.some((d) => d.severity === "skip")) return "skip";
  return "pass";
}

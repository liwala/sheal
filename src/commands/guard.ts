import chalk from "chalk";
import { exec } from "../utils/exec.js";

/**
 * `sheal guard pr` — pre-PR gate. Compiles LEARN-038/LEARN-042 ("verify the
 * branch has commits the base lacks before opening a PR") from prose into an
 * enforceable exit code, designed to run from hooks or CI before
 * `gh pr create`.
 */
export interface GuardPrOptions {
  base: string;
  format: string;
  projectRoot: string;
}

interface GuardIssue {
  rule: string;
  message: string;
}

interface GuardPrReport {
  base: string;
  branch: string;
  aheadCount: number;
  violations: GuardIssue[];
  warnings: GuardIssue[];
}

async function git(projectRoot: string, ...args: string[]) {
  return exec("git", args, { cwd: projectRoot, timeoutMs: 10_000 });
}

export async function runGuardPr(opts: GuardPrOptions): Promise<void> {
  const violations: GuardIssue[] = [];
  const warnings: GuardIssue[] = [];

  const branchResult = await git(opts.projectRoot, "rev-parse", "--abbrev-ref", "HEAD");
  if (branchResult.exitCode !== 0) {
    console.error(chalk.red(`guard pr: not a git repository (${opts.projectRoot})`));
    process.exitCode = 1;
    return;
  }
  const branch = branchResult.stdout.trim();

  if (branch === opts.base) {
    violations.push({
      rule: "on-base-branch",
      message: `HEAD is the base branch "${opts.base}" — create a working branch before opening a PR`,
    });
  }

  const revList = await git(opts.projectRoot, "rev-list", "--count", `${opts.base}..HEAD`);
  const aheadCount = revList.exitCode === 0 ? parseInt(revList.stdout.trim(), 10) || 0 : 0;
  if (revList.exitCode !== 0) {
    violations.push({
      rule: "unknown-base",
      message: `base "${opts.base}" is not a known ref — check --base`,
    });
  } else if (aheadCount === 0 && branch !== opts.base) {
    violations.push({
      rule: "no-commits-ahead",
      message: `"${branch}" has no commits that "${opts.base}" lacks — a PR would be empty`,
    });
  }

  const status = await git(opts.projectRoot, "status", "--porcelain");
  if (status.exitCode === 0 && status.stdout.trim() !== "") {
    warnings.push({
      rule: "uncommitted-changes",
      message: "working tree has uncommitted changes — they will not be part of the PR",
    });
  }

  const report: GuardPrReport = { base: opts.base, branch, aheadCount, violations, warnings };

  if (opts.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(chalk.bold(`Guard pr — "${branch}" vs base "${opts.base}" (${aheadCount} ahead)`));
    for (const v of violations) {
      console.log(`  ${chalk.red("✗")} ${v.rule}: ${v.message}`);
    }
    for (const w of warnings) {
      console.log(`  ${chalk.yellow("!")} ${w.rule}: ${w.message}`);
    }
    if (violations.length === 0 && warnings.length === 0) {
      console.log(chalk.green("  ✓ branch is PR-ready"));
    }
    console.log(chalk.gray("  (compiles LEARN-038: verify branch is ahead of base before PR)"));
  }

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

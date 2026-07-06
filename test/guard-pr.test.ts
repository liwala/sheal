import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

// Compiles LEARN-038/LEARN-042 ("verify the branch has commits the base
// lacks before opening a PR") from prose into a pre-PR gate.
describe("sheal guard pr", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
      cwd,
      encoding: "utf-8",
    });
    expect(result.status, result.stderr).toBe(0);
  }

  function makeRepo(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-guard-pr-"));
    const repo = join(tmp, "repo");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-b", "main");
    writeFileSync(join(repo, "README.md"), "hello\n", "utf-8");
    git(repo, "add", "README.md");
    git(repo, "commit", "-m", "initial");
    return repo;
  }

  function runGuard(repo: string) {
    return spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "guard", "pr", "--base", "main", "--format", "json"],
      { cwd: repo, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf-8" },
    );
  }

  it("passes on a branch with commits the base lacks", () => {
    const repo = makeRepo();
    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "feature.txt"), "work\n", "utf-8");
    git(repo, "add", "feature.txt");
    git(repo, "commit", "-m", "feature work");

    const result = runGuard(repo);

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      branch: string;
      aheadCount: number;
      violations: { rule: string }[];
    };
    expect(report.branch).toBe("feature");
    expect(report.aheadCount).toBe(1);
    expect(report.violations).toEqual([]);
  });

  it("fails when the branch has no commits ahead of the base", () => {
    const repo = makeRepo();
    git(repo, "checkout", "-b", "empty-branch");

    const result = runGuard(repo);

    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as { violations: { rule: string }[] };
    expect(report.violations.map((v) => v.rule)).toContain("no-commits-ahead");
  });

  it("fails when run on the base branch itself", () => {
    const repo = makeRepo();

    const result = runGuard(repo);

    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as { violations: { rule: string }[] };
    expect(report.violations.map((v) => v.rule)).toContain("on-base-branch");
  });

  it("reports uncommitted changes as a warning without failing", () => {
    const repo = makeRepo();
    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "feature.txt"), "work\n", "utf-8");
    git(repo, "add", "feature.txt");
    git(repo, "commit", "-m", "feature work");
    writeFileSync(join(repo, "uncommitted.txt"), "pending\n", "utf-8");

    const result = runGuard(repo);

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { warnings: { rule: string }[] };
    expect(report.warnings.map((w) => w.rule)).toContain("uncommitted-changes");
  });
});

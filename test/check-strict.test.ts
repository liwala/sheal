import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

// Compiles LEARN-007 ("treat sheal check warnings as blockers") from prose
// into an enforced exit code.
describe("sheal check --strict", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeWarningProject(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-check-strict-"));
    const projectRoot = join(tmp, "project");
    mkdirSync(projectRoot, { recursive: true });
    // .env.example without .env produces a deterministic environment warning
    writeFileSync(join(projectRoot, ".env.example"), "API_KEY=\n", "utf-8");
    return projectRoot;
  }

  function runCheck(projectRoot: string, extraArgs: string[] = []) {
    return spawnSync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        join(repoRoot, "src", "index.ts"),
        "check",
        "--format",
        "json",
        "--skip",
        "git,dependencies,tests,performance,claude-settings,session-learnings",
        ...extraArgs,
      ],
      { cwd: projectRoot, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf-8" },
    );
  }

  it("exits 0 on warnings without --strict (current behavior)", () => {
    const projectRoot = makeWarningProject();

    const result = runCheck(projectRoot);

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { summary: { warnings: number } };
    expect(report.summary.warnings).toBeGreaterThan(0);
  });

  it("exits 1 on warnings with --strict", () => {
    const projectRoot = makeWarningProject();

    const result = runCheck(projectRoot, ["--strict"]);

    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as { summary: { warnings: number } };
    expect(report.summary.warnings).toBeGreaterThan(0);
  });

  it("exits 0 with --strict when there are no warnings or failures", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-check-strict-clean-"));
    const projectRoot = join(tmp, "project");
    mkdirSync(projectRoot, { recursive: true });
    // no .env.example, no config: environment checker has nothing to warn
    // about except dev tooling; skip environment too for a fully clean run
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        join(repoRoot, "src", "index.ts"),
        "check",
        "--format",
        "json",
        "--strict",
        "--skip",
        "git,dependencies,tests,performance,claude-settings,session-learnings,environment",
      ],
      { cwd: projectRoot, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf-8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});

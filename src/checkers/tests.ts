import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Checker, CheckResult, CheckerContext } from "./types.js";
import { exec } from "../utils/exec.js";
import { startTimer } from "../utils/timer.js";

interface TestRunner {
  name: string;
  command: string;
  args: string[];
  detect: (root: string) => boolean;
}

const runners: TestRunner[] = [
  {
    name: "npm test",
    command: "npm",
    args: ["test", "--", "--reporter=verbose"],
    detect: (root) => {
      try {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
        return !!pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1';
      } catch { return false; }
    },
  },
  {
    name: "pytest",
    command: "pytest",
    args: ["--tb=no", "-q"],
    detect: (root) => {
      if (existsSync(join(root, "pytest.ini"))) return true;
      try {
        const pyproject = readFileSync(join(root, "pyproject.toml"), "utf-8");
        return pyproject.includes("[tool.pytest");
      } catch { return false; }
    },
  },
  {
    name: "go test",
    command: "go",
    args: ["test", "./..."],
    detect: (root) => existsSync(join(root, "go.mod")),
  },
  {
    name: "cargo test",
    command: "cargo",
    args: ["test"],
    detect: (root) => existsSync(join(root, "Cargo.toml")),
  },
];

export const testsChecker: Checker = {
  name: "tests",
  label: "Test Suite",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const timeoutMs = ctx.config.checkers.tests.timeoutMs;

    // Use configured command or auto-detect
    if (ctx.config.checkers.tests.command) {
      const parts = ctx.config.checkers.tests.command.split(" ");
      const result = await exec(parts[0], parts.slice(1), { cwd: ctx.projectRoot, timeoutMs });

      if (result.timedOut) {
        return {
          name: this.name, label: this.label, severity: "warn",
          details: [{ message: `Test command timed out after ${timeoutMs}ms`, severity: "warn" }],
          durationMs: elapsed(),
        };
      }

      const severity = result.exitCode === 0 ? "pass" : "fail";
      const output = (result.stdout + "\n" + result.stderr).trim().split("\n").slice(-20).join("\n");
      return {
        name: this.name, label: this.label, severity,
        details: [{
          message: severity === "pass" ? "Tests passed" : "Tests failed",
          severity,
          data: { command: ctx.config.checkers.tests.command, output },
        }],
        durationMs: elapsed(),
      };
    }

    // Auto-detect
    const detected = runners.filter((r) => r.detect(ctx.projectRoot));
    if (detected.length === 0) {
      return {
        name: this.name, label: this.label, severity: "warn",
        details: [{ message: "No test suite detected", severity: "warn" }],
        durationMs: elapsed(),
      };
    }

    // Run first detected runner
    const runner = detected[0];
    const result = await exec(runner.command, runner.args, { cwd: ctx.projectRoot, timeoutMs });

    if (result.timedOut) {
      return {
        name: this.name, label: this.label, severity: "warn",
        details: [{ message: `${runner.name} timed out after ${timeoutMs}ms`, severity: "warn" }],
        durationMs: elapsed(),
      };
    }

    const severity = result.exitCode === 0 ? "pass" : "fail";
    const output = (result.stdout + "\n" + result.stderr).trim().split("\n").slice(-20).join("\n");
    return {
      name: this.name, label: this.label, severity,
      details: [{
        message: severity === "pass" ? `${runner.name}: all tests passed` : `${runner.name}: tests failed`,
        severity,
        data: { runner: runner.name, output },
      }],
      durationMs: elapsed(),
    };
  },
};

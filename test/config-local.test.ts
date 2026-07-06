import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config/loader.js";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe(".self-heal.local.json overlay", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeProject(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-local-config-"));
    const projectRoot = join(tmp, "project");
    mkdirSync(projectRoot, { recursive: true });
    return projectRoot;
  }

  it("merges local config over the base .self-heal.json field by field", () => {
    const projectRoot = makeProject();
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      JSON.stringify({
        pull: { stagingDir: "/base/staging" },
        checkers: { environment: { requiredVars: ["BASE_VAR"] } },
      }),
      "utf-8",
    );
    writeFileSync(
      join(projectRoot, ".self-heal.local.json"),
      JSON.stringify({
        checkers: {
          environment: {
            requiredServices: [{ name: "local-probe", check: "true" }],
          },
        },
      }),
      "utf-8",
    );

    const config = loadConfig(projectRoot);

    expect(config.checkers.environment.requiredServices).toEqual([
      { name: "local-probe", check: "true" },
    ]);
    // base fields the local file does not mention survive
    expect(config.checkers.environment.requiredVars).toEqual(["BASE_VAR"]);
    expect(config.pull.stagingDir).toBe("/base/staging");
  });

  it("applies a local config even when no base .self-heal.json exists", () => {
    const projectRoot = makeProject();
    writeFileSync(
      join(projectRoot, ".self-heal.local.json"),
      JSON.stringify({
        checkers: {
          environment: {
            requiredServices: [{ name: "solo-local", check: "true" }],
          },
        },
      }),
      "utf-8",
    );

    const config = loadConfig(projectRoot);

    expect(config.checkers.environment.requiredServices).toEqual([
      { name: "solo-local", check: "true" },
    ]);
  });

  it("ignores a malformed local config and keeps the base config", () => {
    const projectRoot = makeProject();
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      JSON.stringify({ pull: { stagingDir: "/base/staging" } }),
      "utf-8",
    );
    writeFileSync(join(projectRoot, ".self-heal.local.json"), "{ not json", "utf-8");

    const config = loadConfig(projectRoot);

    expect(config.pull.stagingDir).toBe("/base/staging");
  });

  it("sheal check enforces a required service defined only in the local config", () => {
    const projectRoot = makeProject();
    writeFileSync(
      join(projectRoot, ".self-heal.local.json"),
      JSON.stringify({
        checkers: {
          environment: {
            requiredServices: [{ name: "local-probe", check: "true" }],
          },
        },
      }),
      "utf-8",
    );

    const result = spawnSync(
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
      ],
      { cwd: projectRoot, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf-8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      checks: { name: string; details: { message: string }[] }[];
    };
    const environment = report.checks.find((c) => c.name === "environment");
    expect(environment).toBeDefined();
    expect(environment!.details.map((d) => d.message)).toContain(
      'Service "local-probe" is running',
    );
  });
});

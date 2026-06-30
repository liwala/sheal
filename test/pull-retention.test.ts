import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull staging retention", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("removes expired pull staging directories without touching raw registry records", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-retention-"));
    const projectRoot = join(tmp, "project");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });

    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({ pull: { stagingDir: stagingRoot, stagingRetentionDays: 30 } }, null, 2)}\n`,
      "utf-8",
    );

    const expiredDir = writePullStage(stagingRoot, "sbx", "old-sandbox", "2000-01-01T00-00-00-000Z");
    const freshDir = writePullStage(stagingRoot, "sbx", "fresh-sandbox", "2999-01-01T00-00-00-000Z");
    const rawDir = join(projectRoot, ".sheal", "sessions", "raw", "claude:retained-session");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, "manifest.json"), "{\"stableSessionId\":\"claude:retained-session\"}\n", "utf-8");

    const result = runSheal(projectRoot, ["pull", "--gc", "--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      enabled: boolean;
      retentionDays: number;
      removed: string[];
      kept: string[];
    };
    expect(output).toMatchObject({
      enabled: true,
      retentionDays: 30,
      removed: [expiredDir],
      kept: [freshDir],
    });
    expect(existsSync(expiredDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
    expect(readFileSync(join(rawDir, "manifest.json"), "utf-8")).toBe("{\"stableSessionId\":\"claude:retained-session\"}\n");
  });

  it("leaves staging untouched when pull.stagingRetentionDays is unset", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-retention-"));
    const projectRoot = join(tmp, "project");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({ pull: { stagingDir: stagingRoot } }, null, 2)}\n`,
      "utf-8",
    );

    const expiredDir = writePullStage(stagingRoot, "sbx", "old-sandbox", "2000-01-01T00-00-00-000Z");

    const result = runSheal(projectRoot, ["pull", "--gc", "--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      enabled: false,
      retentionDays: null,
      removed: [],
      kept: [expiredDir],
    });
    expect(existsSync(expiredDir)).toBe(true);
  });
});

function runSheal(projectRoot: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: join(projectRoot, ".home"),
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    },
  );
}

function writePullStage(stagingRoot: string, backend: string, name: string, timestamp: string): string {
  const dir = join(stagingRoot, backend, name, timestamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "git.diff"), "diff --git a/file.ts b/file.ts\n", "utf-8");
  return dir;
}

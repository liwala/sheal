import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull config", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("stages sbx material under pull.stagingDir from .self-heal.json", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-config-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const configuredStagingRoot = join(projectRoot, "configured-pulls");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({ pull: { stagingDir: configuredStagingRoot } }, null, 2)}\n`,
      "utf-8",
    );

    const sandboxName = "codex-configured-api";
    const workspace = "/workspace/acme/configured";
    const diff = "diff --git a/src/config.ts b/src/config.ts\n";
    writeSbxFixture(binDir, { sandboxName, workspace, diff });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    const pullDir = getOnlyPullDir(configuredStagingRoot, sandboxName);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(existsSync(join(projectRoot, ".sheal", "pulls", "sbx", sandboxName))).toBe(false);
  });

  it("defaults pull staging to the user sheal home when pull.stagingDir is unset", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-config-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "codex-default-api";
    const workspace = "/workspace/acme/default";
    const diff = "diff --git a/src/default.ts b/src/default.ts\n";
    writeSbxFixture(binDir, { sandboxName, workspace, diff });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    const pullDir = getOnlyPullDir(join(testHome(projectRoot), ".sheal", "pulls"), sandboxName);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(existsSync(join(projectRoot, ".sheal", "pulls", "sbx", sandboxName))).toBe(false);
  });
});

function runShealPull(projectRoot: string, binDir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "pull", ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: testHome(projectRoot),
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    },
  );
}

function getOnlyPullDir(stagingRoot: string, sandboxName: string): string {
  const sandboxRoot = join(stagingRoot, "sbx", sandboxName);
  expect(existsSync(sandboxRoot)).toBe(true);
  const timestamps = readdirSync(sandboxRoot);
  expect(timestamps).toHaveLength(1);
  return join(sandboxRoot, timestamps[0]);
}

function testHome(projectRoot: string): string {
  return join(projectRoot, ".home");
}

function writeSbxFixture(
  binDir: string,
  fixture: { sandboxName: string; workspace: string; diff: string },
): void {
  const sbxPath = join(binDir, "sbx");

  writeFileSync(
    sbxPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const sandboxName = ${JSON.stringify(fixture.sandboxName)};
const workspace = ${JSON.stringify(fixture.workspace)};
const diff = ${JSON.stringify(fixture.diff)};

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({
    sandboxes: [{
      name: sandboxName,
      agent: "codex",
      status: "running",
      workspaces: [workspace]
    }]
  }));
  process.exit(0);
}

if (
  args.length === 6 &&
  args[0] === "exec" &&
  args[1] === sandboxName &&
  args[2] === "git" &&
  args[3] === "-C" &&
  args[4] === workspace &&
  args[5] === "diff"
) {
  process.stdout.write(diff);
  process.exit(0);
}

if (args.length === 3 && args[0] === "cp" && args[1].startsWith(\`\${sandboxName}:\`)) {
  process.stderr.write("missing optional artifact\\n");
  process.exit(2);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    "utf-8",
  );
  chmodSync(sbxPath, 0o755);
}

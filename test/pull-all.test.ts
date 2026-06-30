import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull sbx --all", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("pulls every sbx sandbox with a workspace and skips missing workspaces", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-all-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxes = [
      {
        name: "codex-acme-api",
        agent: "codex",
        status: "running",
        workspaces: ["/Users/example/code/acme/api"],
      },
      {
        name: "claude-web-ui",
        agent: "claude",
        status: "stopped",
        workspaces: ["/Users/example/code/acme/web"],
      },
      {
        name: "codex-missing-worktree",
        agent: "codex",
        status: "stopped",
        workspaces: ["/Users/example/code/acme/missing-worktree"],
        workspace_missing: true,
      },
    ];
    const diffs: Record<string, string> = {
      "codex-acme-api": [
        "diff --git a/src/api.ts b/src/api.ts",
        "index 1111111..2222222 100644",
        "--- a/src/api.ts",
        "+++ b/src/api.ts",
        "@@ -1 +1 @@",
        "-export const status = 'old';",
        "+export const status = 'new';",
        "",
      ].join("\n"),
      "claude-web-ui": [
        "diff --git a/src/app.tsx b/src/app.tsx",
        "index 3333333..4444444 100644",
        "--- a/src/app.tsx",
        "+++ b/src/app.tsx",
        "@@ -1 +1 @@",
        "-export const title = 'old';",
        "+export const title = 'new';",
        "",
      ].join("\n"),
    };

    const sbxPath = join(binDir, "sbx");
    writeFileSync(
      sbxPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const sandboxes = ${JSON.stringify(sandboxes)};
const diffs = ${JSON.stringify(diffs)};

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({ sandboxes }));
  process.exit(0);
}

if (
  args.length === 6 &&
  args[0] === "exec" &&
  args[2] === "git" &&
  args[3] === "-C" &&
  args[5] === "diff"
) {
  const sandbox = sandboxes.find((item) => item.name === args[1]);
  if (sandbox && sandbox.workspaces[0] === args[4] && diffs[sandbox.name]) {
    process.stdout.write(diffs[sandbox.name]);
    process.exit(0);
  }
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(sbxPath, 0o755);

    const result = spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "pull", "sbx", "--all"],
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

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Pulled sbx/codex-acme-api");
    expect(result.stdout).toContain("Pulled sbx/claude-web-ui");
    expect(result.stdout).toContain("Skipped sbx/codex-missing-worktree: missing workspace");
    expect(result.stdout).toContain("Summary: pulled 2, skipped 1, failed 0");

    assertPulledSandbox(projectRoot, "codex-acme-api", diffs["codex-acme-api"], {
      agent: "codex",
      status: "running",
      sourcePaths: ["/Users/example/code/acme/api"],
    });
    assertPulledSandbox(projectRoot, "claude-web-ui", diffs["claude-web-ui"], {
      agent: "claude",
      status: "stopped",
      sourcePaths: ["/Users/example/code/acme/web"],
    });
    expect(existsSync(join(testHome(projectRoot), ".sheal", "pulls", "sbx", "codex-missing-worktree"))).toBe(false);
  }, 15_000);

  it("exits non-zero when every eligible sbx pull fails", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-all-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sbxPath = join(binDir, "sbx");
    writeFileSync(
      sbxPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({
    sandboxes: [{
      name: "codex-failing-api",
      agent: "codex",
      status: "running",
      workspaces: ["/Users/example/code/failing/api"]
    }]
  }));
  process.exit(0);
}

if (args.length === 6 && args[0] === "exec" && args[1] === "codex-failing-api") {
  console.error("git diff failed");
  process.exit(23);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(sbxPath, 0o755);

    const result = spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "pull", "sbx", "--all"],
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

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed sbx/codex-failing-api: git diff failed");
    expect(result.stdout).toContain("Summary: pulled 0, skipped 0, failed 1");
  });

  it("exits non-zero when sbx is unavailable", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-all-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const result = spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "pull", "sbx", "--all"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          HOME: testHome(projectRoot),
          PATH: binDir,
          NO_COLOR: "1",
        },
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Sandbox backend "sbx" is not available');
  });
});

function assertPulledSandbox(
  projectRoot: string,
  sandboxName: string,
  diff: string,
  expected: { agent: string; status: string; sourcePaths: string[] },
): void {
  const stagingRoot = join(testHome(projectRoot), ".sheal", "pulls", "sbx", sandboxName);
  expect(existsSync(stagingRoot)).toBe(true);
  const timestamps = readdirSync(stagingRoot);
  expect(timestamps).toHaveLength(1);

  const pullDir = join(stagingRoot, timestamps[0]);
  expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);

  const provenance = JSON.parse(readFileSync(join(pullDir, "provenance.json"), "utf-8")) as {
    backend?: unknown;
    type?: unknown;
    name?: unknown;
    agent?: unknown;
    status?: unknown;
    pulledAt?: unknown;
    sourcePaths?: unknown;
  };
  expect(provenance).toMatchObject({
    backend: "sbx",
    type: "sbx",
    name: sandboxName,
    agent: expected.agent,
    status: expected.status,
    sourcePaths: expected.sourcePaths,
  });
  expect(typeof provenance.pulledAt).toBe("string");
  expect(Number.isNaN(Date.parse(provenance.pulledAt as string))).toBe(false);
}

function testHome(projectRoot: string): string {
  return join(projectRoot, ".home");
}

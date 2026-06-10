import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull error paths", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("fails clearly for an unknown sbx sandbox without creating a staging dir", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-errors-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const knownSandbox = "codex-acme-api";
    const missingSandbox = "codex-does-not-exist";
    writeSbxFixture(binDir, {
      sandboxes: [{
        name: knownSandbox,
        agent: "codex",
        status: "running",
        workspaces: ["/Users/example/code/acme/api"],
      }],
      diffs: {},
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", missingSandbox]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(missingSandbox);
    expect(result.stderr).toContain("sheal pull --list");
    expect(existsSync(join(projectRoot, ".sheal", "pulls", "sbx", missingSandbox))).toBe(false);
  });

  it("passes sandbox names with shell metacharacters as a single sbx exec argument", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-errors-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "codex-api;touch injected";
    const workspace = "/Users/example/code/acme/api";
    const diff = [
      "diff --git a/src/api.ts b/src/api.ts",
      "index 1111111..2222222 100644",
      "--- a/src/api.ts",
      "+++ b/src/api.ts",
      "@@ -1 +1 @@",
      "-export const status = 'old';",
      "+export const status = 'new';",
      "",
    ].join("\n");

    writeSbxFixture(binDir, {
      sandboxes: [{
        name: sandboxName,
        agent: "codex",
        status: "running",
        workspaces: [workspace],
      }],
      diffs: { [sandboxName]: diff },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(projectRoot, "injected"))).toBe(false);

    const stagingRoot = join(projectRoot, ".sheal", "pulls", "sbx", sandboxName);
    expect(existsSync(stagingRoot)).toBe(true);
    const execLog = JSON.parse(readFileSync(join(tmp, "exec-args.json"), "utf-8")) as string[];
    expect(execLog[0]).toBe(sandboxName);
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
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    },
  );
}

function writeSbxFixture(
  binDir: string,
  fixture: {
    sandboxes: Array<{ name: string; agent: string; status: string; workspaces: string[] }>;
    diffs: Record<string, string>;
  },
): void {
  const sbxPath = join(binDir, "sbx");
  const execArgsPath = join(binDir, "..", "exec-args.json");

  writeFileSync(
    sbxPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const sandboxes = ${JSON.stringify(fixture.sandboxes)};
const diffs = ${JSON.stringify(fixture.diffs)};
const execArgsPath = ${JSON.stringify(execArgsPath)};

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
  writeFileSync(execArgsPath, JSON.stringify(args.slice(1)));
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
}

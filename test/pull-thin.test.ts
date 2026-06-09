import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull sbx <name>", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("captures the sandbox git diff into staging with provenance", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-thin-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "codex-acme-api";
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

    const sbxPath = join(binDir, "sbx");
    writeFileSync(
      sbxPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const sandboxName = ${JSON.stringify(sandboxName)};
const workspace = ${JSON.stringify(workspace)};

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
  process.stdout.write(${JSON.stringify(diff)});
  process.exit(0);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(sbxPath, 0o755);

    const result = spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "pull", "sbx", sandboxName],
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

    expect(result.status, result.stderr).toBe(0);

    const stagingRoot = join(projectRoot, ".sheal", "pulls", "sbx", sandboxName);
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
      agent: "codex",
      status: "running",
      sourcePaths: [workspace],
    });
    expect(typeof provenance.pulledAt).toBe("string");
    expect(Number.isNaN(Date.parse(provenance.pulledAt as string))).toBe(false);
  });
});

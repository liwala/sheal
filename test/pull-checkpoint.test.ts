import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull checkpoint mode", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("writes a checkpoint stage without normalizing into the raw registry", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-checkpoint-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({ pull: { stagingDir: stagingRoot } }, null, 2)}\n`,
      "utf-8",
    );

    const sandboxName = "codex-before-teardown";
    const workspace = "/workspace/acme/checkpoint";
    const home = "/home/codex";
    const diff = "diff --git a/src/checkpoint.ts b/src/checkpoint.ts\n";
    writeSbxFixture(binDir, {
      sandboxes: [{
        name: sandboxName,
        agent: "codex",
        status: "running",
        workspaces: [workspace],
      }],
      homes: { [sandboxName]: home },
      diffs: { [sandboxName]: diff },
      directories: [`${home}/.codex`],
      files: {
        [`${home}/.codex/config.toml`]: "model = \"gpt-5\"\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName, "--checkpoint", "--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      checkpoint?: unknown;
      stagingDir?: unknown;
      gaps?: unknown;
      provenance?: { captureKind?: unknown; gaps?: unknown };
    };
    expect(payload).toMatchObject({
      checkpoint: true,
      gaps: [`${home}/.codex/sessions`],
      provenance: {
        captureKind: "checkpoint",
        gaps: [`${home}/.codex/sessions`],
      },
    });
    expect(typeof payload.stagingDir).toBe("string");

    const pullDir = getOnlyPullDir(stagingRoot, sandboxName);
    expect(payload.stagingDir).toBe(pullDir);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(readFileSync(join(pullDir, "artifacts", ".codex", "config.toml"), "utf-8")).toBe("model = \"gpt-5\"\n");
    expect(readJson(join(pullDir, "checkpoint.json"))).toMatchObject({
      schemaVersion: 1,
      kind: "checkpoint",
      backend: "sbx",
      name: sandboxName,
      captureSet: "pull-adapter",
    });
    expect(readJson(join(pullDir, "provenance.json"))).toMatchObject({
      backend: "sbx",
      name: sandboxName,
      captureKind: "checkpoint",
      gaps: [`${home}/.codex/sessions`],
    });
    expect(existsSync(join(pullDir, "ingested.json"))).toBe(false);
    expect(existsSync(join(projectRoot, ".sheal", "sessions", "raw"))).toBe(false);
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
        HOME: join(projectRoot, ".home"),
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function writeSbxFixture(
  binDir: string,
  fixture: {
    sandboxes: Array<{ name: string; agent: string; status: string; workspaces: string[] }>;
    homes: Record<string, string>;
    diffs: Record<string, string>;
    directories?: string[];
    files?: Record<string, string>;
  },
): void {
  const sbxPath = join(binDir, "sbx");

  writeFileSync(
    sbxPath,
    `#!/usr/bin/env node
import { basename, dirname, join, relative } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const sandboxes = ${JSON.stringify(fixture.sandboxes)};
const homes = ${JSON.stringify(fixture.homes)};
const diffs = ${JSON.stringify(fixture.diffs)};
const directories = ${JSON.stringify(fixture.directories ?? [])};
const files = ${JSON.stringify(fixture.files ?? {})};

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({ sandboxes }));
  process.exit(0);
}

if (
  args.length === 4 &&
  args[0] === "exec" &&
  args[2] === "printenv" &&
  args[3] === "HOME"
) {
  const home = homes[args[1]];
  if (home) {
    process.stdout.write(home + "\\n");
    process.exit(0);
  }
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

if (args.length === 3 && args[0] === "cp") {
  const [sandboxName, sourcePath] = args[1].split(/:(.*)/s);
  const destination = args[2];
  const sandbox = sandboxes.find((item) => item.name === sandboxName);
  if (!sandbox || !sourcePath) {
    console.error(\`missing: \${args[1]}\`);
    process.exit(44);
  }

  if (Object.prototype.hasOwnProperty.call(files, sourcePath)) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, files[sourcePath], "utf-8");
    process.exit(0);
  }

  if (directories.includes(sourcePath)) {
    const targetRoot = join(destination, basename(sourcePath));
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.startsWith(\`\${sourcePath}/\`)) {
        const target = join(targetRoot, relative(sourcePath, filePath));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf-8");
      }
    }
    process.exit(0);
  }

  console.error(\`missing: \${sourcePath}\`);
  process.exit(44);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
  );
  chmodSync(sbxPath, 0o755);
}

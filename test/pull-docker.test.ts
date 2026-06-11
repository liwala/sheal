import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull docker <container>", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("captures diff, agent artifacts, and transcript into docker staging with provenance", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-docker-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const containerName = "codex-acme-api";
    const workspace = "/workspace/acme/api";
    const home = "/home/codex";
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

    writeDockerFixture(binDir, {
      containers: [{
        ID: "0f1e2d3c4b5a",
        Image: "ghcr.io/liwala/codex-runner:latest",
        Names: containerName,
        State: "running",
        Status: "Up 2 hours",
      }],
      workspaces: { [containerName]: workspace },
      homes: { [containerName]: home },
      diffs: { [containerName]: diff },
      directories: [`${home}/.codex`, `${home}/.codex/sessions`],
      files: {
        [`${home}/.codex/config.toml`]: "model = \"gpt-5\"\n",
        [`${home}/.codex/sessions/session-1.jsonl`]: "{\"type\":\"user\",\"content\":\"capture me\"}\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["docker", containerName]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Pulled docker/${containerName}`);
    const pullDir = getOnlyDockerPullDir(projectRoot, containerName);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(readFileSync(join(pullDir, "artifacts", ".codex", "config.toml"), "utf-8")).toBe("model = \"gpt-5\"\n");
    expect(existsSync(join(pullDir, "artifacts", ".claude"))).toBe(false);
    expect(existsSync(join(pullDir, "artifacts", "AGENTS.md"))).toBe(false);
    expect(existsSync(join(pullDir, "artifacts", "MEMORY.md"))).toBe(false);
    expect(readFileSync(join(pullDir, "transcript", ".codex", "sessions", "session-1.jsonl"), "utf-8")).toContain("capture me");

    const provenance = readProvenance(pullDir);
    expect(provenance).toMatchObject({
      backend: "docker",
      type: "docker",
      name: containerName,
      containerId: "0f1e2d3c4b5a",
      image: "ghcr.io/liwala/codex-runner:latest",
      status: "running",
      sourcePaths: [workspace, home],
      gaps: [],
    });
    expect(typeof provenance.pulledAt).toBe("string");
    expect(Number.isNaN(Date.parse(provenance.pulledAt as string))).toBe(false);
  });

  it("does not report missing workspace docs as gaps", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-docker-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const containerName = "claude-missing-capture";
    const workspace = "/workspace/acme/missing";
    const home = "/home/claude";
    const diff = "diff --git a/README.md b/README.md\n";

    writeDockerFixture(binDir, {
      containers: [{
        ID: "123456789abc",
        Image: "node:22",
        Names: containerName,
        State: "exited",
        Status: "Exited (0) 3 minutes ago",
      }],
      workspaces: { [containerName]: workspace },
      homes: { [containerName]: home },
      diffs: { [containerName]: diff },
      directories: [`${home}/.claude`],
      files: {
        [`${home}/.claude/settings.json`]: "{ \"theme\": \"dark\" }\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["docker", containerName]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("Gaps:");
    expect(result.stdout).not.toContain(`${workspace}/AGENTS.md`);
    expect(result.stdout).not.toContain(`${workspace}/MEMORY.md`);
    expect(result.stdout).not.toContain(`${workspace}/.sheal/session.jsonl`);

    const pullDir = getOnlyDockerPullDir(projectRoot, containerName);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(readFileSync(join(pullDir, "artifacts", ".claude", "settings.json"), "utf-8")).toBe("{ \"theme\": \"dark\" }\n");
    expect(existsSync(join(pullDir, "artifacts", "AGENTS.md"))).toBe(false);
    expect(existsSync(join(pullDir, "artifacts", "MEMORY.md"))).toBe(false);

    const provenance = readProvenance(pullDir);
    expect(provenance.gaps).toEqual([]);
  });

  it("rejects docker --all because Docker container selection is human-driven", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-docker-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    writeDockerFixture(binDir, {
      containers: [{
        ID: "0f1e2d3c4b5a",
        Image: "ghcr.io/liwala/codex-runner:latest",
        Names: "codex-acme-api",
        State: "running",
        Status: "Up 2 hours",
      }],
      workspaces: { "codex-acme-api": "/workspace/acme/api" },
      homes: { "codex-acme-api": "/home/codex" },
      diffs: {},
    });

    const result = runShealPull(projectRoot, binDir, ["docker", "--all"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docker --all is not supported");
    expect(result.stderr).toContain("sheal pull --list");
    expect(existsSync(join(projectRoot, ".sheal", "pulls", "docker"))).toBe(false);
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

function getOnlyDockerPullDir(projectRoot: string, containerName: string): string {
  const stagingRoot = join(projectRoot, ".sheal", "pulls", "docker", containerName);
  expect(existsSync(stagingRoot)).toBe(true);
  const timestamps = readdirSync(stagingRoot);
  expect(timestamps).toHaveLength(1);
  return join(stagingRoot, timestamps[0]);
}

function readProvenance(pullDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(pullDir, "provenance.json"), "utf-8")) as Record<string, unknown>;
}

function writeDockerFixture(
  binDir: string,
  fixture: {
    containers: Array<{ ID: string; Image: string; Names: string; State: string; Status: string }>;
    workspaces: Record<string, string>;
    homes: Record<string, string>;
    diffs: Record<string, string>;
    directories?: string[];
    files?: Record<string, string>;
  },
): void {
  const dockerPath = join(binDir, "docker");

  writeFileSync(
    dockerPath,
    `#!/usr/bin/env node
import { basename, dirname, join, relative } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const containers = ${JSON.stringify(fixture.containers)};
const workspaces = ${JSON.stringify(fixture.workspaces)};
const homes = ${JSON.stringify(fixture.homes)};
const diffs = ${JSON.stringify(fixture.diffs)};
const directories = ${JSON.stringify(fixture.directories ?? [])};
const files = ${JSON.stringify(fixture.files ?? {})};

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("docker help\\n");
  process.exit(0);
}

if (args[0] === "ps" && args.includes("--all") && args.includes("--format")) {
  process.stdout.write(containers.map((container) => JSON.stringify(container)).join("\\n") + "\\n");
  process.exit(0);
}

if (args.length === 3 && args[0] === "exec" && args[2] === "pwd") {
  const workspace = workspaces[args[1]];
  if (workspace) {
    process.stdout.write(workspace + "\\n");
    process.exit(0);
  }
}

if (args.length === 4 && args[0] === "exec" && args[2] === "printenv" && args[3] === "HOME") {
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
  const workspace = workspaces[args[1]];
  if (workspace === args[4] && Object.prototype.hasOwnProperty.call(diffs, args[1])) {
    process.stdout.write(diffs[args[1]]);
    process.exit(0);
  }
}

if (args.length === 3 && args[0] === "cp") {
  const [containerName, sourcePath] = args[1].split(/:(.*)/s);
  const destination = args[2];
  if (!workspaces[containerName] || !sourcePath) {
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

console.error(\`unexpected docker args: \${args.join(" ")}\`);
process.exit(99);
`,
  );
  chmodSync(dockerPath, 0o755);
}

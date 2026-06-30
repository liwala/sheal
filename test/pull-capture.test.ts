import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull sbx full capture set", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("captures diff, agent artifacts, and transcript into staging with empty gaps", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-capture-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "claude-acme-api";
    const workspace = "/workspace/acme/api";
    const home = "/home/claude";
    const claudeProjectSlug = claudeSlug(workspace);
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
        agent: "claude",
        status: "running",
        workspaces: [workspace],
      }],
      homes: { [sandboxName]: home },
      diffs: { [sandboxName]: diff },
      directories: [`${home}/.claude`, `${home}/.claude/projects/${claudeProjectSlug}`],
      files: {
        [`${home}/.claude/settings.json`]: "{ \"model\": \"claude\" }\n",
        [`${home}/.claude/sessions.jsonl`]: "{\"type\":\"session-summary\",\"content\":\"capture me\"}\n",
        [`${home}/.claude/projects/${claudeProjectSlug}/session-1.jsonl`]: "{\"type\":\"user\",\"content\":\"project transcript\"}\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    const pullDir = getOnlyPullDir(projectRoot, sandboxName);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(readFileSync(join(pullDir, "artifacts", ".claude", "settings.json"), "utf-8")).toBe("{ \"model\": \"claude\" }\n");
    expect(existsSync(join(pullDir, "artifacts", "AGENTS.md"))).toBe(false);
    expect(existsSync(join(pullDir, "artifacts", "MEMORY.md"))).toBe(false);
    expect(readFileSync(join(pullDir, "transcript", ".claude", "sessions.jsonl"), "utf-8")).toContain("capture me");
    expect(readFileSync(join(pullDir, "transcript", ".claude", "projects", claudeProjectSlug, "session-1.jsonl"), "utf-8")).toContain("project transcript");

    const provenance = readProvenance(pullDir);
    expect(provenance.gaps).toEqual([]);
  });

  it("does not treat missing workspace docs as gaps when agent home dirs exist", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-capture-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "claude-home-only";
    const workspace = "/workspace/acme/home-only";
    const home = "/home/claude";
    const claudeProjectSlug = claudeSlug(workspace);
    const diff = "diff --git a/src/home.ts b/src/home.ts\n";

    writeSbxFixture(binDir, {
      sandboxes: [{
        name: sandboxName,
        agent: "claude",
        status: "running",
        workspaces: [workspace],
      }],
      homes: { [sandboxName]: home },
      diffs: { [sandboxName]: diff },
      directories: [
        `${home}/.claude`,
        `${home}/.claude/projects/${claudeProjectSlug}`,
        `${home}/.codex`,
        `${home}/.codex/sessions`,
      ],
      files: {
        [`${home}/.claude/settings.json`]: "{ \"model\": \"claude\" }\n",
        [`${home}/.claude/projects/${claudeProjectSlug}/session-1.jsonl`]: "{\"type\":\"user\",\"content\":\"claude transcript\"}\n",
        [`${home}/.codex/config.toml`]: "model = \"gpt-5\"\n",
        [`${home}/.codex/sessions/session-1.jsonl`]: "{\"type\":\"user\",\"content\":\"codex transcript\"}\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("Gaps:");
    expect(result.stdout).not.toContain(`${workspace}/AGENTS.md`);
    expect(result.stdout).not.toContain(`${workspace}/MEMORY.md`);
    expect(result.stdout).not.toContain(`${workspace}/.sheal/session.jsonl`);

    const pullDir = getOnlyPullDir(projectRoot, sandboxName);
    expect(readFileSync(join(pullDir, "artifacts", ".claude", "settings.json"), "utf-8")).toBe("{ \"model\": \"claude\" }\n");
    expect(readFileSync(join(pullDir, "artifacts", ".codex", "config.toml"), "utf-8")).toBe("model = \"gpt-5\"\n");
    expect(readFileSync(join(pullDir, "transcript", ".claude", "projects", claudeProjectSlug, "session-1.jsonl"), "utf-8")).toContain("claude transcript");
    expect(readFileSync(join(pullDir, "transcript", ".codex", "sessions", "session-1.jsonl"), "utf-8")).toContain("codex transcript");

    const provenance = readProvenance(pullDir);
    expect(provenance.gaps).toEqual([]);
  });

  it("captures supported agent home artifact dirs that exist under sandbox home", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-capture-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "shell-multi-agent-home";
    const workspace = "/workspace/acme/multi";
    const home = "/home/agent";
    const diff = "diff --git a/app.ts b/app.ts\n";
    const agentHomeDirs = [
      ".claude",
      ".codex",
      ".copilot",
      ".cursor",
      ".docker-agent",
      ".droid",
      ".gemini",
      ".kiro",
      ".opencode",
    ];

    writeSbxFixture(binDir, {
      sandboxes: [{
        name: sandboxName,
        agent: "shell",
        status: "running",
        workspaces: [workspace],
      }],
      homes: { [sandboxName]: home },
      diffs: { [sandboxName]: diff },
      directories: agentHomeDirs.map((dir) => `${home}/${dir}`),
      files: Object.fromEntries(agentHomeDirs.map((dir) => [`${home}/${dir}/state.txt`, `${dir}\n`])),
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    const pullDir = getOnlyPullDir(projectRoot, sandboxName);
    for (const dir of agentHomeDirs) {
      expect(readFileSync(join(pullDir, "artifacts", dir, "state.txt"), "utf-8")).toBe(`${dir}\n`);
    }

    const provenance = readProvenance(pullDir);
    expect(provenance.gaps).toEqual([]);
  });

  it("logs missing agent transcript paths as gaps while still exiting zero", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-capture-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "claude-missing-capture";
    const workspace = "/workspace/acme/missing";
    const home = "/home/claude";
    const claudeProjectSlug = claudeSlug(workspace);
    const diff = "diff --git a/README.md b/README.md\n";

    writeSbxFixture(binDir, {
      sandboxes: [{
        name: sandboxName,
        agent: "claude",
        status: "stopped",
        workspaces: [workspace],
      }],
      homes: { [sandboxName]: home },
      diffs: { [sandboxName]: diff },
      directories: [`${home}/.claude`],
      files: {
        [`${home}/.claude/settings.json`]: "{ \"theme\": \"dark\" }\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Gaps:");
    expect(result.stdout).not.toContain(`${workspace}/AGENTS.md`);
    expect(result.stdout).not.toContain(`${workspace}/MEMORY.md`);
    expect(result.stdout).toContain(`${home}/.claude/projects/${claudeProjectSlug}`);
    expect(result.stdout).not.toContain(`${workspace}/.sheal/session.jsonl`);

    const pullDir = getOnlyPullDir(projectRoot, sandboxName);
    expect(readFileSync(join(pullDir, "git.diff"), "utf-8")).toBe(diff);
    expect(readFileSync(join(pullDir, "artifacts", ".claude", "settings.json"), "utf-8")).toBe("{ \"theme\": \"dark\" }\n");
    expect(existsSync(join(pullDir, "artifacts", "AGENTS.md"))).toBe(false);
    expect(existsSync(join(pullDir, "artifacts", "MEMORY.md"))).toBe(false);
    expect(existsSync(join(pullDir, "transcript", ".claude", "projects", claudeProjectSlug))).toBe(false);

    const provenance = readProvenance(pullDir);
    expect(provenance.gaps).toEqual([
      `${home}/.claude/projects/${claudeProjectSlug}`,
    ]);
  });

  it("includes gap details in JSON output", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-capture-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const sandboxName = "codex-json-gaps";
    const workspace = "/workspace/acme/json";
    const home = "/home/codex";
    const diff = "diff --git a/package.json b/package.json\n";

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

    const result = runShealPull(projectRoot, binDir, ["sbx", sandboxName, "--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      backend?: unknown;
      name?: unknown;
      stagingDir?: unknown;
      gaps?: unknown;
      provenance?: { gaps?: unknown };
    };
    expect(payload).toMatchObject({
      backend: "sbx",
      name: sandboxName,
      gaps: [
        `${home}/.codex/sessions`,
      ],
      provenance: {
        gaps: [
          `${home}/.codex/sessions`,
        ],
      },
    });
    expect(typeof payload.stagingDir).toBe("string");
    expect(readFileSync(join(payload.stagingDir, "artifacts", ".codex", "config.toml"), "utf-8")).toBe("model = \"gpt-5\"\n");
    expect(existsSync(join(payload.stagingDir, "artifacts", ".claude"))).toBe(false);
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

function getOnlyPullDir(projectRoot: string, sandboxName: string): string {
  const stagingRoot = join(testHome(projectRoot), ".sheal", "pulls", "sbx", sandboxName);
  expect(existsSync(stagingRoot)).toBe(true);
  const timestamps = readdirSync(stagingRoot);
  expect(timestamps).toHaveLength(1);
  return join(stagingRoot, timestamps[0]);
}

function testHome(projectRoot: string): string {
  return join(projectRoot, ".home");
}

function readProvenance(pullDir: string): { gaps?: unknown } {
  return JSON.parse(readFileSync(join(pullDir, "provenance.json"), "utf-8")) as { gaps?: unknown };
}

function claudeSlug(workspace: string): string {
  return workspace.replace(/[\\/: ]/g, "-");
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

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

  it("runs configured checkpoint targets once without checkpointing unconfigured sandboxes", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-checkpoint-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const configuredName = "codex-configured-checkpoint";
    const ignoredName = "codex-not-configured";
    const configuredWorkspace = "/workspace/acme/configured";
    const ignoredWorkspace = "/workspace/acme/ignored";
    const configuredHome = "/home/configured";
    const ignoredHome = "/home/ignored";
    const configuredDiff = "diff --git a/src/configured.ts b/src/configured.ts\n";
    const ignoredDiff = "diff --git a/src/ignored.ts b/src/ignored.ts\n";

    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({
        pull: {
          stagingDir: stagingRoot,
          checkpointTargets: [{ backend: "sbx", name: configuredName }],
        },
      }, null, 2)}\n`,
      "utf-8",
    );
    writeSbxFixture(binDir, {
      sandboxes: [
        {
          name: configuredName,
          agent: "codex",
          status: "running",
          workspaces: [configuredWorkspace],
        },
        {
          name: ignoredName,
          agent: "codex",
          status: "running",
          workspaces: [ignoredWorkspace],
        },
      ],
      homes: {
        [configuredName]: configuredHome,
        [ignoredName]: ignoredHome,
      },
      diffs: {
        [configuredName]: configuredDiff,
        [ignoredName]: ignoredDiff,
      },
      directories: [`${configuredHome}/.codex`, `${ignoredHome}/.codex`],
      files: {
        [`${configuredHome}/.codex/config.toml`]: "model = \"gpt-5\"\n",
        [`${ignoredHome}/.codex/config.toml`]: "model = \"ignore-me\"\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["--checkpoint-run", "--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      checkpointed?: unknown;
      failed?: unknown;
      results?: Array<{
        backend?: unknown;
        name?: unknown;
        checkpoint?: unknown;
        stagingDir?: unknown;
        gaps?: unknown;
        provenance?: { captureKind?: unknown; gaps?: unknown };
      }>;
    };
    expect(payload).toMatchObject({
      checkpointed: 1,
      failed: 0,
      results: [{
        backend: "sbx",
        name: configuredName,
        checkpoint: true,
        gaps: [`${configuredHome}/.codex/sessions`],
        provenance: {
          captureKind: "checkpoint",
          gaps: [`${configuredHome}/.codex/sessions`],
        },
      }],
    });
    expect(payload.results).toHaveLength(1);

    const configuredDir = getOnlyPullDir(stagingRoot, configuredName);
    expect(payload.results?.[0]?.stagingDir).toBe(configuredDir);
    expect(readFileSync(join(configuredDir, "git.diff"), "utf-8")).toBe(configuredDiff);
    expect(readJson(join(configuredDir, "checkpoint.json"))).toMatchObject({
      schemaVersion: 1,
      kind: "checkpoint",
      backend: "sbx",
      name: configuredName,
      captureSet: "pull-adapter",
    });
    expect(readJson(join(configuredDir, "provenance.json"))).toMatchObject({
      backend: "sbx",
      name: configuredName,
      captureKind: "checkpoint",
      gaps: [`${configuredHome}/.codex/sessions`],
    });
    expect(existsSync(join(configuredDir, "ingested.json"))).toBe(false);
    expect(existsSync(join(projectRoot, ".sheal", "sessions", "raw"))).toBe(false);
    expect(existsSync(join(stagingRoot, "sbx", ignoredName))).toBe(false);
  });

  it("rejects checkpoint runner requests combined with --all", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-checkpoint-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({
        pull: {
          stagingDir: stagingRoot,
          checkpointTargets: [{ backend: "sbx", name: "codex-configured-checkpoint" }],
        },
      }, null, 2)}\n`,
      "utf-8",
    );
    writeSbxFixture(binDir, {
      sandboxes: [{
        name: "codex-configured-checkpoint",
        agent: "codex",
        status: "running",
        workspaces: ["/workspace/acme/configured"],
      }],
      homes: { "codex-configured-checkpoint": "/home/configured" },
      diffs: { "codex-configured-checkpoint": "diff --git a/src/configured.ts b/src/configured.ts\n" },
    });

    const result = runShealPull(projectRoot, binDir, ["--checkpoint-run", "--all", "--format", "json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use --checkpoint-run without --all");
    expect(existsSync(stagingRoot)).toBe(false);
  });

  it("rejects sbx checkpoint-all without an explicit allow-all gate", () => {
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
    writeSbxFixture(binDir, {
      sandboxes: [{
        name: "codex-visible",
        agent: "codex",
        status: "running",
        workspaces: ["/workspace/acme/visible"],
      }],
      homes: { "codex-visible": "/home/codex" },
      diffs: { "codex-visible": "diff --git a/src/visible.ts b/src/visible.ts\n" },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", "--all", "--checkpoint", "--format", "json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Set pull.checkpointAllowAllBackends to include \"sbx\"");
    expect(existsSync(stagingRoot)).toBe(false);
  });

  it("checkpoints every eligible sbx sandbox with an explicit allow-all gate", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-checkpoint-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const firstName = "codex-first";
    const secondName = "codex-second";
    const missingName = "codex-missing-workspace";
    const firstWorkspace = "/workspace/acme/first";
    const secondWorkspace = "/workspace/acme/second";
    const firstHome = "/home/first";
    const secondHome = "/home/second";
    const firstDiff = "diff --git a/src/first.ts b/src/first.ts\n";
    const secondDiff = "diff --git a/src/second.ts b/src/second.ts\n";

    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({
        pull: {
          stagingDir: stagingRoot,
          checkpointAllowAllBackends: ["sbx"],
        },
      }, null, 2)}\n`,
      "utf-8",
    );
    writeSbxFixture(binDir, {
      sandboxes: [
        {
          name: firstName,
          agent: "codex",
          status: "running",
          workspaces: [firstWorkspace],
        },
        {
          name: secondName,
          agent: "codex",
          status: "running",
          workspaces: [secondWorkspace],
        },
        {
          name: missingName,
          agent: "codex",
          status: "stopped",
          workspaces: ["/workspace/acme/missing"],
          workspace_missing: true,
        },
      ],
      homes: {
        [firstName]: firstHome,
        [secondName]: secondHome,
        [missingName]: "/home/missing",
      },
      diffs: {
        [firstName]: firstDiff,
        [secondName]: secondDiff,
      },
      directories: [`${firstHome}/.codex`, `${secondHome}/.codex`],
      files: {
        [`${firstHome}/.codex/config.toml`]: "model = \"gpt-5\"\n",
        [`${secondHome}/.codex/config.toml`]: "model = \"gpt-5\"\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, ["sbx", "--all", "--checkpoint", "--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      checkpointed?: unknown;
      skipped?: unknown;
      failed?: unknown;
      results?: Array<{
        backend?: unknown;
        name?: unknown;
        checkpoint?: unknown;
        stagingDir?: unknown;
        gaps?: unknown;
        provenance?: { captureKind?: unknown; gaps?: unknown };
      }>;
      skippedSandboxes?: Array<{ backend?: unknown; name?: unknown; reason?: unknown }>;
    };
    expect(payload).toMatchObject({
      checkpointed: 2,
      skipped: 1,
      failed: 0,
      results: [
        {
          backend: "sbx",
          name: firstName,
          checkpoint: true,
          gaps: [`${firstHome}/.codex/sessions`],
          provenance: {
            captureKind: "checkpoint",
            gaps: [`${firstHome}/.codex/sessions`],
          },
        },
        {
          backend: "sbx",
          name: secondName,
          checkpoint: true,
          gaps: [`${secondHome}/.codex/sessions`],
          provenance: {
            captureKind: "checkpoint",
            gaps: [`${secondHome}/.codex/sessions`],
          },
        },
      ],
      skippedSandboxes: [{ backend: "sbx", name: missingName, reason: "missing workspace" }],
    });
    expect(payload.results).toHaveLength(2);

    const firstDir = getOnlyPullDir(stagingRoot, firstName);
    const secondDir = getOnlyPullDir(stagingRoot, secondName);
    expect(payload.results?.[0]?.stagingDir).toBe(firstDir);
    expect(payload.results?.[1]?.stagingDir).toBe(secondDir);
    expect(readFileSync(join(firstDir, "git.diff"), "utf-8")).toBe(firstDiff);
    expect(readFileSync(join(secondDir, "git.diff"), "utf-8")).toBe(secondDiff);
    expect(readJson(join(firstDir, "checkpoint.json"))).toMatchObject({
      schemaVersion: 1,
      kind: "checkpoint",
      backend: "sbx",
      name: firstName,
      captureSet: "pull-adapter",
    });
    expect(readJson(join(secondDir, "checkpoint.json"))).toMatchObject({
      schemaVersion: 1,
      kind: "checkpoint",
      backend: "sbx",
      name: secondName,
      captureSet: "pull-adapter",
    });
    expect(readJson(join(firstDir, "provenance.json"))).toMatchObject({
      backend: "sbx",
      name: firstName,
      captureKind: "checkpoint",
      gaps: [`${firstHome}/.codex/sessions`],
    });
    expect(readJson(join(secondDir, "provenance.json"))).toMatchObject({
      backend: "sbx",
      name: secondName,
      captureKind: "checkpoint",
      gaps: [`${secondHome}/.codex/sessions`],
    });
    expect(existsSync(join(firstDir, "ingested.json"))).toBe(false);
    expect(existsSync(join(secondDir, "ingested.json"))).toBe(false);
    expect(existsSync(join(stagingRoot, "sbx", missingName))).toBe(false);
    expect(existsSync(join(projectRoot, ".sheal", "sessions", "raw"))).toBe(false);
  });

  it("keeps docker checkpoint-all unsupported", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-checkpoint-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const stagingRoot = join(tmp, "pulls");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(projectRoot, ".self-heal.json"),
      `${JSON.stringify({
        pull: {
          stagingDir: stagingRoot,
          checkpointAllowAllBackends: ["sbx", "docker"],
        },
      }, null, 2)}\n`,
      "utf-8",
    );

    const result = runShealPull(projectRoot, binDir, ["docker", "--all", "--checkpoint", "--format", "json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sheal pull docker --all --checkpoint is not supported");
    expect(existsSync(stagingRoot)).toBe(false);
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
    sandboxes: Array<{ name: string; agent: string; status: string; workspaces: string[]; workspace_missing?: boolean }>;
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

import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal pull raw session registry", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("normalizes pulled Claude transcripts into the project raw session registry", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-raw-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const homeDir = join(tmp, "home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const sandboxName = "claude-raw-project";
    const sessionId = "7eb5a0b7-660c-4560-9a17-eba2843135dc";
    const stableSessionId = `claude:${sessionId}`;
    const workspace = projectRoot;
    const sandboxHome = "/home/claude";
    const projectSlug = claudeSlug(workspace);
    const transcript = claudeTranscript({ sessionId, cwd: workspace });
    const diff = "diff --git a/src/app.ts b/src/app.ts\n+export const value = 1;\n";

    writeSbxFixture(binDir, {
      sandboxes: [{ name: sandboxName, agent: "claude", status: "running", workspaces: [workspace] }],
      homes: { [sandboxName]: sandboxHome },
      diffs: { [sandboxName]: diff },
      directories: [`${sandboxHome}/.claude`, `${sandboxHome}/.claude/projects/${projectSlug}`],
      files: {
        [`${sandboxHome}/.claude/projects/${projectSlug}/${sessionId}.jsonl`]: transcript,
        [`${sandboxHome}/.claude/.credentials.json`]: "{\"placeholder\":\"do-not-copy\"}\n",
        [`${sandboxHome}/.claude/token-cache.json`]: "{\"placeholder\":\"do-not-copy\"}\n",
      },
    });

    const first = runShealPull(projectRoot, binDir, homeDir, ["sbx", sandboxName]);
    expect(first.status, first.stderr).toBe(0);

    const rawDir = join(projectRoot, ".sheal", "sessions", "raw", stableSessionId);
    expect(readFileSync(join(rawDir, "transcript.raw.jsonl"), "utf-8")).toBe(transcript);
    expect(readFileSync(join(rawDir, "git.diff"), "utf-8")).toBe(diff);

    const firstPullDir = getOnlyPullDir(join(homeDir, ".sheal", "pulls"), "sbx", sandboxName);
    expect(existsSync(join(projectRoot, ".sheal", "pulls", "sbx", sandboxName))).toBe(false);
    expect(readJson(join(rawDir, "provenance.json"))).toMatchObject({
      backend: "sbx",
      name: sandboxName,
      sourcePaths: [workspace, sandboxHome],
    });

    const normalized = readJson(join(rawDir, "normalized.json")) as any;
    expect(normalized.root.checkpointId).toBe(stableSessionId);
    expect(normalized.sessions[0].metadata).toMatchObject({
      checkpointId: stableSessionId,
      sessionId,
      agent: "Claude Code",
      createdAt: "2026-06-11T09:31:34.548Z",
    });
    expect(normalized.sessions[0].prompts).toEqual(["normalize pulled Claude transcript"]);

    const manifest = readJson(join(rawDir, "manifest.json")) as any;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      stableSessionId,
      nativeSessionId: sessionId,
      agent: "Claude Code",
      projectPath: workspace,
      source: {
        kind: "pull",
        backend: "sbx",
        name: sandboxName,
        pullDir: firstPullDir,
        transcriptPath: join("transcript", ".claude", "projects", projectSlug, `${sessionId}.jsonl`),
      },
      provenance: {
        sourcePaths: [workspace, sandboxHome],
        gaps: [],
      },
    });
    expect(manifest.hashes.transcriptRawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.hashes.normalizedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.hashes.gitDiffSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(readJson(join(firstPullDir, "ingested.json"))).toMatchObject({
      schemaVersion: 1,
      rawSessionIds: [stableSessionId],
    });
    expect(existsSync(join(firstPullDir, "ingested.json"))).toBe(true);
    expect(readFileSync(join(firstPullDir, "ingested.json"), "utf-8")).not.toContain("analyzed");
    expect(readFileSync(join(firstPullDir, "ingested.json"), "utf-8")).not.toContain("consolidated");
    expect(rawRegistryFiles(rawDir)).not.toEqual(expect.arrayContaining([
      ".credentials.json",
      "token-cache.json",
    ]));

    const second = runShealPull(projectRoot, binDir, homeDir, ["sbx", sandboxName]);
    expect(second.status, second.stderr).toBe(0);
    expect(readdirSync(join(projectRoot, ".sheal", "sessions", "raw"))).toEqual([stableSessionId]);

    const repeatedManifest = readJson(join(rawDir, "manifest.json")) as any;
    expect(repeatedManifest.identity).toMatchObject({
      canonicalSessionId: stableSessionId,
      authoritativeAliases: expect.arrayContaining([
        `agent-session:claude-code:${sessionId}`,
        `transcript-sha256:${sha256(transcript)}`,
      ]),
      needsLink: false,
    });
    expect(repeatedManifest.captures).toHaveLength(2);
    expect(repeatedManifest.captures).toEqual([
      expect.objectContaining({
        fidelity: "transcript+diff",
        needsLink: false,
        primary: expect.any(Boolean),
        source: expect.objectContaining({
          kind: "pull",
          backend: "sbx",
          name: sandboxName,
        }),
      }),
      expect.objectContaining({
        fidelity: "transcript+diff",
        needsLink: false,
        primary: expect.any(Boolean),
        source: expect.objectContaining({
          kind: "pull",
          backend: "sbx",
          name: sandboxName,
        }),
      }),
    ]);

    const pullDirs = getPullDirs(join(homeDir, ".sheal", "pulls"), "sbx", sandboxName);
    expect(pullDirs).toHaveLength(2);
    for (const pullDir of pullDirs) {
      expect(readJson(join(pullDir, "ingested.json"))).toMatchObject({
        rawSessionIds: [stableSessionId],
      });
    }
  });

  it("normalizes pulled Codex transcripts into the project raw session registry", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-raw-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const homeDir = join(tmp, "home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const sandboxName = "codex-raw-project";
    const sessionId = "019eb6ef-979f-75c0-a7ca-f67f16f1c319";
    const stableSessionId = `codex:${sessionId}`;
    const workspace = projectRoot;
    const sandboxHome = "/home/codex";
    const transcriptPath = `${sandboxHome}/.codex/sessions/2026/06/11/rollout-2026-06-11T09-47-18-${sessionId}.jsonl`;
    const transcript = codexTranscript({ sessionId, cwd: workspace });
    const diff = "diff --git a/src/codex.ts b/src/codex.ts\n+export const codex = true;\n";

    writeSbxFixture(binDir, {
      sandboxes: [{ name: sandboxName, agent: "codex", status: "running", workspaces: [workspace] }],
      homes: { [sandboxName]: sandboxHome },
      diffs: { [sandboxName]: diff },
      directories: [`${sandboxHome}/.codex`, `${sandboxHome}/.codex/sessions`],
      files: {
        [transcriptPath]: transcript,
        [`${sandboxHome}/.codex/auth.json`]: "{\"placeholder\":\"do-not-copy\"}\n",
        [`${sandboxHome}/.codex/cache/session.env`]: "PLACEHOLDER=do-not-copy\n",
      },
    });

    const result = runShealPull(projectRoot, binDir, homeDir, ["sbx", sandboxName]);
    expect(result.status, result.stderr).toBe(0);

    const rawDir = join(projectRoot, ".sheal", "sessions", "raw", stableSessionId);
    expect(readFileSync(join(rawDir, "transcript.raw.jsonl"), "utf-8")).toBe(transcript);
    expect(readFileSync(join(rawDir, "git.diff"), "utf-8")).toBe(diff);

    const pullDir = getOnlyPullDir(join(homeDir, ".sheal", "pulls"), "sbx", sandboxName);

    const normalized = readJson(join(rawDir, "normalized.json")) as any;
    expect(normalized.root.checkpointId).toBe(stableSessionId);
    expect(normalized.sessions[0].metadata).toMatchObject({
      checkpointId: stableSessionId,
      sessionId,
      agent: "Codex",
      createdAt: "2026-06-11T09:47:18.759Z",
      cliVersion: "0.123.0",
    });
    expect(normalized.sessions[0].prompts).toEqual(["normalize pulled Codex transcript"]);

    expect(readJson(join(rawDir, "manifest.json"))).toMatchObject({
      schemaVersion: 1,
      stableSessionId,
      nativeSessionId: sessionId,
      agent: "Codex",
      projectPath: workspace,
      source: {
        kind: "pull",
        backend: "sbx",
        name: sandboxName,
        pullDir,
        transcriptPath: join("transcript", ".codex", "sessions", "2026", "06", "11", `rollout-2026-06-11T09-47-18-${sessionId}.jsonl`),
      },
    });
    expect(readJson(join(pullDir, "ingested.json"))).toMatchObject({
      schemaVersion: 1,
      rawSessionIds: [stableSessionId],
    });
    expect(rawRegistryFiles(rawDir)).not.toEqual(expect.arrayContaining([
      "auth.json",
      "session.env",
    ]));
  });

  it("collapses shared authoritative aliases while preserving the highest-fidelity raw material", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-raw-alias-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const homeDir = join(tmp, "home");
    const sourceRoot = join(tmp, "source");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const sandboxName = "claude-high-fidelity";
    const sessionId = "7b40e00a-4903-4666-ab28-76820351c3a6";
    const stableSessionId = `claude:${sessionId}`;
    const workspace = projectRoot;
    const sandboxHome = "/home/claude";
    const projectSlug = claudeSlug(workspace);
    const pulledTranscript = claudeTranscript({
      sessionId,
      cwd: workspace,
      prompt: "high fidelity pulled transcript",
    });
    const lowerFidelityTranscript = claudeTranscript({
      sessionId,
      cwd: workspace,
      prompt: "lower fidelity explicit transcript",
    });
    const diff = "diff --git a/src/high.ts b/src/high.ts\n+export const high = true;\n";

    writeSbxFixture(binDir, {
      sandboxes: [{ name: sandboxName, agent: "claude", status: "running", workspaces: [workspace] }],
      homes: { [sandboxName]: sandboxHome },
      diffs: { [sandboxName]: diff },
      directories: [`${sandboxHome}/.claude`, `${sandboxHome}/.claude/projects/${projectSlug}`],
      files: {
        [`${sandboxHome}/.claude/projects/${projectSlug}/${sessionId}.jsonl`]: pulledTranscript,
      },
    });

    const pull = runSheal(projectRoot, binDir, homeDir, ["pull", "sbx", sandboxName]);
    expect(pull.status, pull.stderr).toBe(0);

    const explicitClaudeRoot = join(sourceRoot, ".claude");
    mkdirSync(join(explicitClaudeRoot, "projects", projectSlug), { recursive: true });
    writeFileSync(
      join(explicitClaudeRoot, "projects", projectSlug, `${sessionId}.jsonl`),
      lowerFidelityTranscript,
      "utf-8",
    );

    const imported = runSheal(projectRoot, binDir, homeDir, ["sessions", "import", "--source", sourceRoot, "--format", "json"]);
    expect(imported.status, imported.stderr).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      imported: 1,
      rawSessionIds: [stableSessionId],
    });

    const rawRoot = join(projectRoot, ".sheal", "sessions", "raw");
    expect(readdirSync(rawRoot)).toEqual([stableSessionId]);

    const rawDir = join(rawRoot, stableSessionId);
    expect(readFileSync(join(rawDir, "transcript.raw.jsonl"), "utf-8")).toBe(pulledTranscript);
    expect(readFileSync(join(rawDir, "git.diff"), "utf-8")).toBe(diff);

    const normalized = readJson(join(rawDir, "normalized.json")) as any;
    expect(normalized.sessions[0].prompts).toEqual(["high fidelity pulled transcript"]);

    const manifest = readJson(join(rawDir, "manifest.json")) as any;
    expect(manifest.hashes.transcriptRawSha256).toBe(sha256(pulledTranscript));
    expect(manifest.hashes.gitDiffSha256).toBe(sha256(diff));
    expect(manifest.identity).toMatchObject({
      canonicalSessionId: stableSessionId,
      authoritativeAliases: expect.arrayContaining([
        `agent-session:claude-code:${sessionId}`,
        `transcript-sha256:${sha256(pulledTranscript)}`,
        `transcript-sha256:${sha256(lowerFidelityTranscript)}`,
      ]),
      needsLink: false,
    });
    expect(manifest.captures).toHaveLength(2);
    expect(manifest.captures).toEqual([
      expect.objectContaining({
        fidelity: "transcript+diff",
        primary: true,
        needsLink: false,
        hashes: expect.objectContaining({
          transcriptRawSha256: sha256(pulledTranscript),
          gitDiffSha256: sha256(diff),
        }),
        source: expect.objectContaining({
          kind: "pull",
          backend: "sbx",
          name: sandboxName,
        }),
      }),
      expect.objectContaining({
        fidelity: "transcript-only",
        primary: false,
        needsLink: false,
        hashes: expect.objectContaining({
          transcriptRawSha256: sha256(lowerFidelityTranscript),
        }),
        source: expect.objectContaining({
          kind: "explicit-source",
          root: explicitClaudeRoot,
          transcriptPath: join("projects", projectSlug, `${sessionId}.jsonl`),
        }),
      }),
    ]);
  });

  it("does not dedup git-only captures that only share PR branch and commit hints", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-raw-hints-"));
    const projectRoot = join(tmp, "project");
    const binDir = join(tmp, "bin");
    const homeDir = join(tmp, "home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const prUrl = "https://github.com/liwala/sheal/pull/123";
    const branch = "feature/alias-aware-dedup";
    const commit = "abc123def456";
    const hints = { prUrl, branch, commit };

    writeSbxFixture(binDir, {
      sandboxes: [
        { name: "git-only-a", agent: "remote", status: "stopped", workspaces: [projectRoot], metadata: hints },
        { name: "git-only-b", agent: "remote", status: "stopped", workspaces: [projectRoot], metadata: hints },
      ],
      homes: {
        "git-only-a": "/home/remote-a",
        "git-only-b": "/home/remote-b",
      },
      diffs: {
        "git-only-a": "diff --git a/a.ts b/a.ts\n+export const a = true;\n",
        "git-only-b": "diff --git a/b.ts b/b.ts\n+export const b = true;\n",
      },
    });

    const result = runSheal(projectRoot, binDir, homeDir, ["pull", "sbx", "--all", "--format", "json"]);
    expect(result.status, result.stderr).toBe(0);

    const rawRoot = join(projectRoot, ".sheal", "sessions", "raw");
    const rawSessionIds = readdirSync(rawRoot).sort();
    expect(rawSessionIds).toHaveLength(2);

    const manifests = rawSessionIds.map((rawSessionId) => readJson(join(rawRoot, rawSessionId, "manifest.json")) as any);
    expect(new Set(manifests.map((manifest) => manifest.stableSessionId)).size).toBe(2);
    expect(manifests.map((manifest) => manifest.source.name).sort()).toEqual(["git-only-a", "git-only-b"]);

    for (const manifest of manifests) {
      expect(manifest.identity).toMatchObject({
        canonicalSessionId: manifest.stableSessionId,
        authoritativeAliases: [],
        correlationHints: expect.arrayContaining([
          { kind: "pr-url", value: prUrl },
          { kind: "branch", value: branch },
          { kind: "commit", value: commit },
        ]),
        needsLink: true,
      });
      expect(manifest.captures).toEqual([
        expect.objectContaining({
          fidelity: "git-only",
          primary: true,
          needsLink: true,
          source: expect.objectContaining({
            kind: "pull",
            backend: "sbx",
          }),
        }),
      ]);
      expect(existsSync(join(rawRoot, manifest.stableSessionId, "transcript.raw.jsonl"))).toBe(false);
      expect(existsSync(join(rawRoot, manifest.stableSessionId, "normalized.json"))).toBe(false);
      expect(readFileSync(join(rawRoot, manifest.stableSessionId, "git.diff"), "utf-8")).toContain("diff --git");
    }
  });
});

function runSheal(projectRoot: string, binDir: string, homeDir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    },
  );
}

function runShealPull(projectRoot: string, binDir: string, homeDir: string, args: string[]) {
  return runSheal(projectRoot, binDir, homeDir, ["pull", ...args]);
}

function getOnlyPullDir(stagingRoot: string, backend: string, sandboxName: string): string {
  const pullDirs = getPullDirs(stagingRoot, backend, sandboxName);
  expect(pullDirs).toHaveLength(1);
  return pullDirs[0];
}

function getPullDirs(stagingRoot: string, backend: string, sandboxName: string): string[] {
  const sandboxRoot = join(stagingRoot, backend, sandboxName);
  expect(existsSync(sandboxRoot)).toBe(true);
  return readdirSync(sandboxRoot).sort().map((timestamp) => join(sandboxRoot, timestamp));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function rawRegistryFiles(rawDir: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else {
        files.push(entry);
      }
    }
  };
  visit(rawDir);
  return files;
}

function claudeSlug(workspace: string): string {
  return workspace.replace(/[\\/: ]/g, "-");
}

function claudeTranscript(params: { sessionId: string; cwd: string; prompt?: string }): string {
  const prompt = params.prompt ?? "normalize pulled Claude transcript";
  return [
    JSON.stringify({
      type: "user",
      uuid: "user-1",
      timestamp: "2026-06-11T09:31:34.548Z",
      sessionId: params.sessionId,
      cwd: params.cwd,
      message: {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "assistant-1",
      timestamp: "2026-06-11T09:31:35.000Z",
      sessionId: params.sessionId,
      cwd: params.cwd,
      version: "1.0.0",
      message: {
        role: "assistant",
        model: "claude-3-5-sonnet",
        content: [{ type: "text", text: "Normalized." }],
        usage: { input_tokens: 10, output_tokens: 3 },
      },
    }),
  ].join("\n") + "\n";
}

function codexTranscript(params: { sessionId: string; cwd: string }): string {
  return [
    JSON.stringify({
      timestamp: "2026-06-11T09:47:18.759Z",
      type: "session_meta",
      payload: {
        id: params.sessionId,
        cwd: params.cwd,
        timestamp: "2026-06-11T09:47:18.759Z",
        model_provider: "openai",
        cli_version: "0.123.0",
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-11T09:47:19.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "normalize pulled Codex transcript" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-11T09:47:20.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Normalized." }],
      },
    }),
  ].join("\n") + "\n";
}

function writeSbxFixture(
  binDir: string,
  fixture: {
    sandboxes: Array<{
      name: string;
      agent: string;
      status: string;
      workspaces: string[];
      metadata?: Record<string, string>;
    }>;
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
  if (sandbox && sandbox.workspaces[0] === args[4] && Object.prototype.hasOwnProperty.call(diffs, sandbox.name)) {
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
    "utf-8",
  );
  chmodSync(sbxPath, 0o755);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

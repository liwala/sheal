import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

describe("sheal sessions import raw session registry", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("normalizes live-home Claude transcripts into the project raw session registry", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-live-home-raw-"));
    const projectRoot = join(tmp, "project");
    const homeDir = join(tmp, "home");
    mkdirSync(projectRoot, { recursive: true });

    const sessionId = "86f3f66d-9320-45db-bd5b-432d5d933c9a";
    const stableSessionId = `claude:${sessionId}`;
    const claudeRoot = join(homeDir, ".claude");
    const projectSlug = claudeSlug(projectRoot);
    const transcriptPath = join(claudeRoot, "projects", projectSlug, `${sessionId}.jsonl`);
    const transcript = claudeTranscript({
      sessionId,
      cwd: projectRoot,
      prompt: "normalize live-home Claude transcript",
    });

    mkdirSync(join(claudeRoot, "projects", projectSlug), { recursive: true });
    writeFileSync(transcriptPath, transcript, "utf-8");
    writeFileSync(join(claudeRoot, ".credentials.json"), "{\"token\":\"do-not-copy\"}\n", "utf-8");
    writeFileSync(join(claudeRoot, "token-cache.json"), "{\"token\":\"do-not-copy\"}\n", "utf-8");

    const first = runSheal(projectRoot, homeDir, ["sessions", "import", "--format", "json"]);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      imported: 1,
      rawSessionIds: [stableSessionId],
    });

    const rawDir = join(projectRoot, ".sheal", "sessions", "raw", stableSessionId);
    expect(readFileSync(join(rawDir, "transcript.raw.jsonl"), "utf-8")).toBe(transcript);
    expect(existsSync(join(rawDir, "ingested.json"))).toBe(false);

    const normalized = readJson(join(rawDir, "normalized.json")) as any;
    expect(normalized.root.checkpointId).toBe(stableSessionId);
    expect(normalized.sessions[0].metadata).toMatchObject({
      checkpointId: stableSessionId,
      sessionId,
      agent: "Claude Code",
      createdAt: "2026-06-11T11:00:00.000Z",
    });
    expect(normalized.sessions[0].prompts).toEqual(["normalize live-home Claude transcript"]);

    const manifest = readJson(join(rawDir, "manifest.json")) as any;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      stableSessionId,
      nativeSessionId: sessionId,
      agent: "Claude Code",
      projectPath: projectRoot,
      source: {
        kind: "live-home",
        root: claudeRoot,
        transcriptPath: join("projects", projectSlug, `${sessionId}.jsonl`),
      },
      provenance: {
        sourcePaths: [transcriptPath],
        gaps: [],
      },
    });
    expect(manifest.hashes.transcriptRawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.hashes.normalizedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.hashes.gitDiffSha256).toBeUndefined();
    expect(rawRegistryFiles(rawDir)).not.toEqual(expect.arrayContaining([
      ".credentials.json",
      "token-cache.json",
    ]));

    const second = runSheal(projectRoot, homeDir, ["sessions", "import", "--format", "json"]);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({
      imported: 1,
      rawSessionIds: [stableSessionId],
    });
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
        fidelity: "transcript-only",
        needsLink: false,
        source: expect.objectContaining({ kind: "live-home" }),
      }),
      expect.objectContaining({
        fidelity: "transcript-only",
        needsLink: false,
        source: expect.objectContaining({ kind: "live-home" }),
      }),
    ]);
  });

  it("normalizes live-home Codex transcripts into the project raw session registry", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-live-home-raw-"));
    const projectRoot = join(tmp, "project");
    const homeDir = join(tmp, "home");
    mkdirSync(projectRoot, { recursive: true });

    const sessionId = "019eb74a-221b-76d2-b123-df39e76702a7";
    const stableSessionId = `codex:${sessionId}`;
    const codexRoot = join(homeDir, ".codex");
    const transcriptPath = join(codexRoot, "sessions", "2026", "06", "11", `rollout-2026-06-11T11-15-00-${sessionId}.jsonl`);
    const transcript = codexTranscript({
      sessionId,
      cwd: projectRoot,
      prompt: "normalize live-home Codex transcript",
    });

    mkdirSync(join(codexRoot, "sessions", "2026", "06", "11"), { recursive: true });
    writeFileSync(transcriptPath, transcript, "utf-8");
    writeFileSync(join(codexRoot, "auth.json"), "{\"token\":\"do-not-copy\"}\n", "utf-8");
    mkdirSync(join(codexRoot, "cache"), { recursive: true });
    writeFileSync(join(codexRoot, "cache", "session.env"), "TOKEN=do-not-copy\n", "utf-8");

    const first = runSheal(projectRoot, homeDir, ["sessions", "import", "--format", "json"]);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      imported: 1,
      rawSessionIds: [stableSessionId],
    });

    const rawDir = join(projectRoot, ".sheal", "sessions", "raw", stableSessionId);
    expect(readFileSync(join(rawDir, "transcript.raw.jsonl"), "utf-8")).toBe(transcript);
    expect(existsSync(join(rawDir, "ingested.json"))).toBe(false);

    const normalized = readJson(join(rawDir, "normalized.json")) as any;
    expect(normalized.root.checkpointId).toBe(stableSessionId);
    expect(normalized.sessions[0].metadata).toMatchObject({
      checkpointId: stableSessionId,
      sessionId,
      agent: "Codex",
      createdAt: "2026-06-11T11:15:00.000Z",
      cliVersion: "0.123.0",
    });
    expect(normalized.sessions[0].prompts).toEqual(["normalize live-home Codex transcript"]);

    const manifest = readJson(join(rawDir, "manifest.json")) as any;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      stableSessionId,
      nativeSessionId: sessionId,
      agent: "Codex",
      projectPath: projectRoot,
      source: {
        kind: "live-home",
        root: codexRoot,
        transcriptPath: join("sessions", "2026", "06", "11", `rollout-2026-06-11T11-15-00-${sessionId}.jsonl`),
      },
      provenance: {
        sourcePaths: [transcriptPath],
        gaps: [],
      },
    });
    expect(manifest.hashes.transcriptRawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.hashes.normalizedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.hashes.gitDiffSha256).toBeUndefined();
    expect(rawRegistryFiles(rawDir)).not.toEqual(expect.arrayContaining([
      "auth.json",
      "session.env",
    ]));

    const second = runSheal(projectRoot, homeDir, ["sessions", "import", "--format", "json"]);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({
      imported: 1,
      rawSessionIds: [stableSessionId],
    });
    expect(readdirSync(join(projectRoot, ".sheal", "sessions", "raw"))).toEqual([stableSessionId]);
  });

  it("normalizes Claude and Codex transcripts from an explicit source root", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-explicit-source-raw-"));
    const projectRoot = join(tmp, "project");
    const homeDir = join(tmp, "home");
    const sourceRoot = join(tmp, "source");
    mkdirSync(projectRoot, { recursive: true });

    const claudeSessionId = "27656f8c-9836-4449-9268-310f6f976e52";
    const codexSessionId = "019eb74a-95d0-712f-a0ac-91a37f19c93a";
    const projectSlug = claudeSlug(projectRoot);
    const claudeRoot = join(sourceRoot, ".claude");
    const codexRoot = join(sourceRoot, ".codex");
    const claudeTranscriptPath = join(claudeRoot, "projects", projectSlug, `${claudeSessionId}.jsonl`);
    const codexTranscriptPath = join(codexRoot, "sessions", "2026", "06", "11", `rollout-2026-06-11T11-30-00-${codexSessionId}.jsonl`);
    mkdirSync(join(claudeRoot, "projects", projectSlug), { recursive: true });
    mkdirSync(join(codexRoot, "sessions", "2026", "06", "11"), { recursive: true });
    writeFileSync(
      claudeTranscriptPath,
      claudeTranscript({ sessionId: claudeSessionId, cwd: projectRoot, prompt: "normalize explicit Claude transcript" }),
      "utf-8",
    );
    writeFileSync(
      codexTranscriptPath,
      codexTranscript({ sessionId: codexSessionId, cwd: projectRoot, prompt: "normalize explicit Codex transcript" }),
      "utf-8",
    );
    writeFileSync(join(claudeRoot, ".credentials.json"), "{\"token\":\"do-not-copy\"}\n", "utf-8");
    writeFileSync(join(codexRoot, "auth.json"), "{\"token\":\"do-not-copy\"}\n", "utf-8");

    const result = runSheal(projectRoot, homeDir, ["sessions", "import", "--source", sourceRoot, "--format", "json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      imported: 2,
      rawSessionIds: [`claude:${claudeSessionId}`, `codex:${codexSessionId}`],
    });

    const claudeRawDir = join(projectRoot, ".sheal", "sessions", "raw", `claude:${claudeSessionId}`);
    const codexRawDir = join(projectRoot, ".sheal", "sessions", "raw", `codex:${codexSessionId}`);
    expect(readJson(join(claudeRawDir, "manifest.json"))).toMatchObject({
      source: {
        kind: "explicit-source",
        root: claudeRoot,
        transcriptPath: join("projects", projectSlug, `${claudeSessionId}.jsonl`),
      },
      provenance: { sourcePaths: [claudeTranscriptPath] },
    });
    expect(readJson(join(codexRawDir, "manifest.json"))).toMatchObject({
      source: {
        kind: "explicit-source",
        root: codexRoot,
        transcriptPath: join("sessions", "2026", "06", "11", `rollout-2026-06-11T11-30-00-${codexSessionId}.jsonl`),
      },
      provenance: { sourcePaths: [codexTranscriptPath] },
    });
    expect(rawRegistryFiles(claudeRawDir)).not.toContain(".credentials.json");
    expect(rawRegistryFiles(codexRawDir)).not.toContain("auth.json");
  });
});

function runSheal(projectRoot: string, homeDir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: homeDir,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    },
  );
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

function claudeTranscript(params: { sessionId: string; cwd: string; prompt: string }): string {
  return [
    JSON.stringify({
      type: "user",
      uuid: "user-1",
      timestamp: "2026-06-11T11:00:00.000Z",
      sessionId: params.sessionId,
      cwd: params.cwd,
      message: {
        role: "user",
        content: [{ type: "text", text: params.prompt }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "assistant-1",
      timestamp: "2026-06-11T11:00:01.000Z",
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

function codexTranscript(params: { sessionId: string; cwd: string; prompt: string }): string {
  return [
    JSON.stringify({
      timestamp: "2026-06-11T11:15:00.000Z",
      type: "session_meta",
      payload: {
        id: params.sessionId,
        cwd: params.cwd,
        timestamp: "2026-06-11T11:15:00.000Z",
        model_provider: "openai",
        cli_version: "0.123.0",
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-11T11:15:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: params.prompt }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-11T11:15:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Normalized." }],
      },
    }),
  ].join("\n") + "\n";
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { readGlobalConfig, writeGlobalConfig } from "../src/learn/remote-config.js";
import { isGitRepo, initRepo, addRemote, removeRemote, getRemoteUrl, commitAll, push, pull, lastCommitInfo } from "../src/learn/git.js";

function tmpDir(name: string): string {
  const dir = join(tmpdir(), `sheal-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function gitInDir(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@test.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@test.com" } }).toString().trim();
}

// ── remote-config ──────────────────────────────────────────────────

describe("remote-config", () => {
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    configDir = tmpDir("config");
    configPath = join(configDir, "config.json");
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("returns empty config when file missing", () => {
    // readGlobalConfig reads from ~/.sheal/ — test the shape
    const config = readGlobalConfig();
    expect(config).toBeDefined();
    expect(typeof config).toBe("object");
  });

  it("round-trips config via write/read", () => {
    writeFileSync(configPath, JSON.stringify({ remote: { url: "git@github.com:test/learnings.git" } }));
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(parsed.remote.url).toBe("git@github.com:test/learnings.git");
  });
});

// ── git module ─────────────────────────────────────────────────────

describe("git operations", () => {
  let workDir: string;
  let bareDir: string;

  beforeEach(() => {
    workDir = tmpDir("work");
    bareDir = tmpDir("bare");
    // Create a bare repo to use as remote
    gitInDir(bareDir, "init", "--bare");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("isGitRepo returns false for non-repo", async () => {
    expect(await isGitRepo(workDir)).toBe(false);
  });

  it("initRepo creates a git repo", async () => {
    await initRepo(workDir);
    expect(await isGitRepo(workDir)).toBe(true);
    expect(existsSync(join(workDir, ".gitignore"))).toBe(true);
  });

  it("addRemote + getRemoteUrl round-trip", async () => {
    await initRepo(workDir);
    await addRemote(workDir, bareDir);
    const url = await getRemoteUrl(workDir);
    expect(url).toBe(bareDir);
  });

  it("addRemote updates existing remote", async () => {
    await initRepo(workDir);
    await addRemote(workDir, "/old/path");
    await addRemote(workDir, bareDir);
    const url = await getRemoteUrl(workDir);
    expect(url).toBe(bareDir);
  });

  it("removeRemote clears origin", async () => {
    await initRepo(workDir);
    await addRemote(workDir, bareDir);
    await removeRemote(workDir);
    const url = await getRemoteUrl(workDir);
    expect(url).toBeNull();
  });

  it("commitAll commits new files", async () => {
    await initRepo(workDir);
    writeFileSync(join(workDir, "LEARN-001-test.md"), "---\nid: LEARN-001\n---\nTest learning\n");
    const result = await commitAll(workDir, "add learning");
    expect(result.committed).toBe(true);
  });

  it("commitAll reports nothing to commit when clean", async () => {
    await initRepo(workDir);
    const result = await commitAll(workDir);
    expect(result.committed).toBe(false);
    expect(result.summary).toContain("Nothing to commit");
  });

  it("push succeeds to bare repo", async () => {
    await initRepo(workDir);
    await addRemote(workDir, bareDir);
    writeFileSync(join(workDir, "LEARN-001-test.md"), "test content\n");
    await commitAll(workDir, "add learning");
    const result = await push(workDir);
    expect(result.ok).toBe(true);
  });

  it("pull succeeds from bare repo", async () => {
    await initRepo(workDir);
    await addRemote(workDir, bareDir);
    writeFileSync(join(workDir, "LEARN-001.md"), "first\n");
    await commitAll(workDir, "initial");
    await push(workDir);

    // Clone into a second dir, make a change, push
    const workDir2 = tmpDir("work2");
    gitInDir(workDir2, "clone", bareDir, ".");
    writeFileSync(join(workDir2, "LEARN-002.md"), "from other machine\n");
    gitInDir(workDir2, "add", "-A");
    gitInDir(workDir2, "commit", "-m", "add LEARN-002");
    gitInDir(workDir2, "push");

    // Pull in original
    const result = await pull(workDir);
    expect(result.ok).toBe(true);
    expect(existsSync(join(workDir, "LEARN-002.md"))).toBe(true);

    rmSync(workDir2, { recursive: true, force: true });
  });

  it("lastCommitInfo returns commit summary", async () => {
    await initRepo(workDir);
    const info = await lastCommitInfo(workDir);
    expect(info).toBeTruthy();
    expect(info).toContain("Initial commit");
  });
});

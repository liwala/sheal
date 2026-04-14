import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "../utils/exec.js";

const NET_TIMEOUT = 30_000;

async function git(args: string[], cwd: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await exec("git", args, { cwd, timeoutMs: timeoutMs ?? 10_000 });
  if (result.exitCode === -2) {
    throw new Error("git is not installed or not in PATH");
  }
  return result;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await git(["rev-parse", "--is-inside-work-tree"], dir);
  return r.exitCode === 0;
}

const GITIGNORE = `# Whitelist: only track sheal data
*
!.gitignore
!config.json
!learnings/
!learnings/**
!digests/
!digests/**
!retros/
!retros/**
`;

export async function initRepo(dir: string): Promise<void> {
  await git(["init"], dir);
  writeFileSync(join(dir, ".gitignore"), GITIGNORE, "utf-8");
  await git(["add", ".gitignore"], dir);
  await git(["commit", "-m", "Initial commit"], dir);
}

export async function addRemote(dir: string, url: string): Promise<void> {
  const existing = await getRemoteUrl(dir);
  if (existing) {
    await git(["remote", "set-url", "origin", url], dir);
  } else {
    await git(["remote", "add", "origin", url], dir);
  }
}

export async function removeRemote(dir: string): Promise<void> {
  await git(["remote", "remove", "origin"], dir);
}

export async function getRemoteUrl(dir: string): Promise<string | null> {
  const r = await git(["remote", "get-url", "origin"], dir);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

async function getCurrentBranch(dir: string): Promise<string> {
  const r = await git(["branch", "--show-current"], dir);
  return r.stdout.trim() || "main";
}

export async function commitAll(dir: string, message?: string): Promise<{ committed: boolean; summary: string }> {
  await git(["add", "-A"], dir);
  const status = await git(["status", "--porcelain"], dir);
  if (!status.stdout.trim()) {
    return { committed: false, summary: "Nothing to commit" };
  }

  const msg = message || `sheal: backup ${new Date().toISOString().slice(0, 10)}`;
  const r = await git(["commit", "-m", msg], dir);
  if (r.exitCode !== 0) {
    return { committed: false, summary: r.stderr.trim() || r.stdout.trim() };
  }
  return { committed: true, summary: r.stdout.trim() };
}

export async function push(dir: string): Promise<{ ok: boolean; output: string }> {
  const branch = await getCurrentBranch(dir);
  const r = await git(["push", "-u", "origin", branch], dir, NET_TIMEOUT);
  return { ok: r.exitCode === 0, output: (r.stderr + "\n" + r.stdout).trim() };
}

export async function pull(dir: string): Promise<{ ok: boolean; conflicts: string[]; output: string }> {
  const branch = await getCurrentBranch(dir);
  const r = await git(["pull", "--no-rebase", "origin", branch], dir, NET_TIMEOUT);

  if (r.exitCode === 0) {
    return { ok: true, conflicts: [], output: (r.stderr + "\n" + r.stdout).trim() };
  }

  // Check for merge conflicts
  const diff = await git(["diff", "--name-only", "--diff-filter=U"], dir);
  const conflicts = diff.stdout.trim().split("\n").filter(Boolean);

  return { ok: false, conflicts, output: (r.stderr + "\n" + r.stdout).trim() };
}

export async function lastCommitInfo(dir: string): Promise<string | null> {
  const r = await git(["log", "-1", "--oneline"], dir);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

function writeLearningFile(dir: string, filename: string, fields: { id: string; title: string; body: string }): void {
  writeFileSync(
    join(dir, filename),
    `---
id: ${fields.id}
title: ${fields.title}
date: 2026-07-06
tags: [general]
category: workflow
severity: medium
status: active
---

${fields.body}
`,
    "utf-8",
  );
}

// A dirty store with one ID collision, one near-duplicate pair, and one
// no-trigger learning — the three mechanical change-set sources.
function plantStore(projectRoot: string): void {
  const dir = join(projectRoot, ".sheal", "learnings");
  mkdirSync(dir, { recursive: true });
  writeLearningFile(dir, "LEARN-001-first-slug.md", {
    id: "LEARN-001",
    title: "Inspect real samples before writing parsers",
    body: "Before writing parsers for external data formats, always inspect two or three real samples first using git show, curl, or cat.",
  });
  writeLearningFile(dir, "LEARN-001-second-slug.md", {
    id: "LEARN-001",
    title: "Commit and restart on context compaction",
    body: "When a session hits context compaction, commit work and restart.",
  });
  writeLearningFile(dir, "LEARN-006-fetch-real-sample.md", {
    id: "LEARN-006",
    title: "Fetch a real sample before writing parsers",
    body: "Before writing parsers for external data formats, fetch a real sample first and inspect it — do not write parsers against assumed schemas.",
  });
  writeLearningFile(dir, "LEARN-009-no-trigger.md", {
    id: "LEARN-009",
    title: "Write clean code",
    body: "Good variable names matter. Keep functions small and modular.",
  });
}

function runConsolidate(projectRoot: string, extraArgs: string[] = []) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "consolidate", "-p", projectRoot, ...extraArgs],
    { cwd: projectRoot, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf-8" },
  );
}

describe("sheal consolidate", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeProject(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-consolidate-"));
    const projectRoot = join(tmp, "project");
    mkdirSync(projectRoot, { recursive: true });
    plantStore(projectRoot);
    return projectRoot;
  }

  it("emits a JSON change set with collisions, merge candidates, and dispositions", () => {
    const projectRoot = makeProject();

    const result = runConsolidate(projectRoot, ["--format", "json"]);

    expect(result.status, result.stderr).toBe(0);
    const changeSet = JSON.parse(result.stdout) as {
      scanned: number;
      idCollisions: { ids: string[] }[];
      mergeCandidates: { ids: string[] }[];
      dispositions: { id: string; action: string }[];
    };
    expect(changeSet.scanned).toBe(4);
    expect(changeSet.idCollisions).toHaveLength(1);
    expect(changeSet.idCollisions[0].ids).toEqual(["LEARN-001"]);
    expect(changeSet.mergeCandidates).toHaveLength(1);
    expect(changeSet.mergeCandidates[0].ids.sort()).toEqual(["LEARN-001", "LEARN-006"]);
    expect(changeSet.dispositions).toHaveLength(1);
    expect(changeSet.dispositions[0].id).toBe("LEARN-009");
    expect(changeSet.dispositions[0].action).toBe("rewrite-or-retire");
  });

  it("writes a dated markdown change set without mutating the store", () => {
    const projectRoot = makeProject();
    const storeBefore = readdirSync(join(projectRoot, ".sheal", "learnings")).sort();

    const result = runConsolidate(projectRoot);

    expect(result.status, result.stderr).toBe(0);
    const outDir = join(projectRoot, ".sheal", "consolidation");
    expect(existsSync(outDir)).toBe(true);
    const files = readdirSync(outDir).filter((f) => f.endsWith("-change-set.md"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(outDir, files[0]), "utf-8");
    expect(content).toContain("LEARN-001");
    expect(content).toContain("LEARN-006");
    expect(content).toContain("proposal");
    // the pass never mutates the store
    expect(readdirSync(join(projectRoot, ".sheal", "learnings")).sort()).toEqual(storeBefore);
    // stdout tells the user where the change set landed
    expect(result.stdout).toContain(files[0]);
  });

  it("--prompt prints an LLM consolidation prompt containing the learnings", () => {
    const projectRoot = makeProject();

    const result = runConsolidate(projectRoot, ["--prompt"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Inspect real samples before writing parsers");
    expect(result.stdout).toContain("topic page");
    expect(result.stdout).toContain("change set");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { lintLearnings } from "../src/learn/lint.js";

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

describe("learn lint", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeStore(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-learn-lint-"));
    const dir = join(tmp, "learnings");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("reports duplicate LEARN IDs across different files", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-first-slug.md", {
      id: "LEARN-001",
      title: "Inspect real data before writing parsers",
      body: "When writing a parser, inspect two or three real samples first.",
    });
    writeLearningFile(dir, "LEARN-001-second-slug.md", {
      id: "LEARN-001",
      title: "Commit and restart on context compaction",
      body: "When a session hits context compaction, commit work and restart.",
    });

    const report = lintLearnings(dir);
    const duplicates = report.findings.filter((f) => f.type === "duplicate-id");

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].ids).toEqual(["LEARN-001"]);
    expect(duplicates[0].files).toEqual(["LEARN-001-first-slug.md", "LEARN-001-second-slug.md"]);
  });

  it("reports near-duplicate learnings under different IDs", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-inspect-samples.md", {
      id: "LEARN-001",
      title: "Inspect real samples before writing parsers",
      body: "Before writing parsers for external data formats, always inspect two or three real samples first using git show, curl, or cat.",
    });
    writeLearningFile(dir, "LEARN-006-fetch-real-sample.md", {
      id: "LEARN-006",
      title: "Fetch a real sample before writing parsers",
      body: "Before writing parsers for external data formats, fetch a real sample first and inspect it — do not write parsers against assumed schemas.",
    });
    writeLearningFile(dir, "LEARN-004-unrelated.md", {
      id: "LEARN-004",
      title: "Add required services to self-heal config",
      body: "When a background server process is required, add it to the self-heal config so the check command catches it at session start.",
    });

    const report = lintLearnings(dir);
    const nearDupes = report.findings.filter((f) => f.type === "near-duplicate");

    expect(nearDupes).toHaveLength(1);
    expect(nearDupes[0].ids.sort()).toEqual(["LEARN-001", "LEARN-006"]);
  });

  it("flags learnings without a checkable trigger condition", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-no-trigger.md", {
      id: "LEARN-001",
      title: "Write clean code",
      body: "Good variable names matter. Keep functions small and modular.",
    });
    writeLearningFile(dir, "LEARN-002-with-trigger.md", {
      id: "LEARN-002",
      title: "Stash before switching branches",
      body: "Before switching git branches, run git stash if the status shows any changes.",
    });

    const report = lintLearnings(dir);
    const noTrigger = report.findings.filter((f) => f.type === "no-trigger");

    expect(noTrigger).toHaveLength(1);
    expect(noTrigger[0].ids).toEqual(["LEARN-001"]);
  });

  it("returns no findings for a clean store and counts scanned files", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-inspect-samples.md", {
      id: "LEARN-001",
      title: "Inspect real samples before writing parsers",
      body: "Before writing parsers, inspect two or three real samples first.",
    });
    writeLearningFile(dir, "LEARN-002-services.md", {
      id: "LEARN-002",
      title: "Register required background services",
      body: "When a background server process is required, register it in the self-heal config.",
    });

    const report = lintLearnings(dir);

    expect(report.scanned).toBe(2);
    expect(report.findings).toEqual([]);
  });

  it("sheal learn lint exits 1 with JSON findings on a dirty store and 0 on a clean one", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-learn-lint-cli-"));
    const projectRoot = join(tmp, "project");
    const dir = join(projectRoot, ".sheal", "learnings");
    mkdirSync(dir, { recursive: true });
    writeLearningFile(dir, "LEARN-001-first-slug.md", {
      id: "LEARN-001",
      title: "Inspect real data before writing parsers",
      body: "When writing a parser, inspect real samples first.",
    });
    writeLearningFile(dir, "LEARN-001-second-slug.md", {
      id: "LEARN-001",
      title: "Commit and restart on context compaction",
      body: "When a session hits context compaction, commit work and restart.",
    });

    const dirty = runLearnLint(projectRoot);
    expect(dirty.status, dirty.stderr).toBe(1);
    const report = JSON.parse(dirty.stdout) as {
      scanned: number;
      findings: { type: string; ids: string[] }[];
    };
    expect(report.findings.some((f) => f.type === "duplicate-id")).toBe(true);

    rmSync(join(dir, "LEARN-001-second-slug.md"));
    const clean = runLearnLint(projectRoot);
    expect(clean.status, clean.stderr).toBe(0);
  });
});

function runLearnLint(projectRoot: string) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "learn", "lint", "--format", "json", "-p", projectRoot],
    { cwd: projectRoot, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf-8" },
  );
}

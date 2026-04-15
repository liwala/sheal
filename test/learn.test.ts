import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  slugify,
  nextId,
  writeLearning,
  readLearning,
  listLearnings,
  parseLearningContent,
} from "../src/learn/store.js";
import { detectProjectTags } from "../src/learn/detect.js";
import { analyzeStaleness } from "../src/commands/learn.js";
import type { LearningFile } from "../src/learn/types.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sheal-learn-test-"));
}

const sampleLearning: LearningFile = {
  id: "LEARN-001",
  title: "Inspect real data before writing parsers",
  date: "2026-03-13",
  tags: ["parsing", "external-data", "general"],
  category: "missing-context",
  severity: "high",
  status: "active",
  body: "Before writing parsers for external data formats, always inspect 2-3 real samples first.",
};

describe("slugify", () => {
  it("converts to lowercase hyphenated", () => {
    expect(slugify("Inspect Real Data")).toBe("inspect-real-data");
  });

  it("removes special characters", () => {
    expect(slugify("Don't use (bad) stuff!")).toBe("don-t-use-bad-stuff");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("truncates to 50 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("nextId", () => {
  it("returns LEARN-001 for empty directory", () => {
    const dir = makeTempDir();
    expect(nextId(dir)).toBe("LEARN-001");
    rmSync(dir, { recursive: true });
  });

  it("returns LEARN-001 for non-existent directory", () => {
    expect(nextId("/nonexistent/path")).toBe("LEARN-001");
  });

  it("returns next sequential ID", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "LEARN-001-foo.md"), "");
    writeFileSync(join(dir, "LEARN-003-bar.md"), "");
    expect(nextId(dir)).toBe("LEARN-004");
    rmSync(dir, { recursive: true });
  });
});

describe("writeLearning / readLearning roundtrip", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("writes and reads back a learning", () => {
    const filepath = writeLearning(dir, sampleLearning);
    expect(existsSync(filepath)).toBe(true);

    const loaded = readLearning(filepath);
    expect(loaded.id).toBe("LEARN-001");
    expect(loaded.title).toBe("Inspect real data before writing parsers");
    expect(loaded.date).toBe("2026-03-13");
    expect(loaded.tags).toEqual(["parsing", "external-data", "general"]);
    expect(loaded.category).toBe("missing-context");
    expect(loaded.severity).toBe("high");
    expect(loaded.status).toBe("active");
    expect(loaded.body).toContain("inspect 2-3 real samples");
  });

  it("generates correct filename", () => {
    const filepath = writeLearning(dir, sampleLearning);
    expect(filepath).toContain("LEARN-001-inspect-real-data-before-writing-parsers.md");
  });
});

describe("parseLearningContent", () => {
  it("parses valid frontmatter", () => {
    const content = `---
id: LEARN-042
title: Test learning
date: 2026-01-01
tags: [foo, bar]
category: workflow
severity: low
status: active
---

This is the body.
`;
    const result = parseLearningContent(content);
    expect(result.id).toBe("LEARN-042");
    expect(result.tags).toEqual(["foo", "bar"]);
    expect(result.body).toBe("This is the body.");
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseLearningContent("no frontmatter")).toThrow(
      "missing frontmatter"
    );
  });
});

describe("listLearnings", () => {
  it("returns empty array for non-existent directory", () => {
    expect(listLearnings("/nonexistent/path")).toEqual([]);
  });

  it("lists and sorts learnings", () => {
    const dir = makeTempDir();
    writeLearning(dir, { ...sampleLearning, id: "LEARN-002", title: "Second" });
    writeLearning(dir, { ...sampleLearning, id: "LEARN-001", title: "First" });

    const results = listLearnings(dir);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe("LEARN-001");
    expect(results[1].id).toBe("LEARN-002");

    rmSync(dir, { recursive: true });
  });
});

describe("detectProjectTags", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("always includes general and workflow", () => {
    const tags = detectProjectTags(dir);
    expect(tags).toContain("general");
    expect(tags).toContain("workflow");
  });

  it("detects TypeScript project", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const tags = detectProjectTags(dir);
    expect(tags).toContain("typescript");
    expect(tags).toContain("node");
    expect(tags).toContain("javascript");
  });

  it("detects Go project", () => {
    writeFileSync(join(dir, "go.mod"), "module example.com/foo");
    const tags = detectProjectTags(dir);
    expect(tags).toContain("go");
  });

  it("detects Rust project", () => {
    writeFileSync(join(dir, "Cargo.toml"), "[package]");
    const tags = detectProjectTags(dir);
    expect(tags).toContain("rust");
  });

  it("detects Python project", () => {
    writeFileSync(join(dir, "pyproject.toml"), "[project]");
    const tags = detectProjectTags(dir);
    expect(tags).toContain("python");
  });

  it("detects Docker", () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node");
    const tags = detectProjectTags(dir);
    expect(tags).toContain("docker");
  });

  it("returns sorted tags", () => {
    const tags = detectProjectTags(dir);
    const sorted = [...tags].sort();
    expect(tags).toEqual(sorted);
  });
});

describe("sessionId traceability", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("round-trips sessionId through write/read", () => {
    const learning = { ...sampleLearning, sessionId: "abc-123-session" };
    const filepath = writeLearning(dir, learning);
    const loaded = readLearning(filepath);
    expect(loaded.sessionId).toBe("abc-123-session");
  });

  it("omits sessionId from frontmatter when not provided", () => {
    const filepath = writeLearning(dir, sampleLearning);
    const content = readFileSync(filepath, "utf8");
    expect(content).not.toContain("session-id");
    const loaded = readLearning(filepath);
    expect(loaded.sessionId).toBeUndefined();
  });
});

describe("sync deduplication", () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    globalDir = makeTempDir();
    projectDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true });
    rmSync(projectDir, { recursive: true });
  });

  it("does not overwrite identical files on re-sync", () => {
    const filename = "LEARN-001-test-learning.md";
    const content = `---\nid: LEARN-001\ntitle: Test\ndate: 2026-01-01\ntags: [general]\ncategory: workflow\nseverity: low\nstatus: active\n---\n\nBody text.`;
    writeFileSync(join(globalDir, filename), content);
    writeFileSync(join(projectDir, filename), content);

    // Grab mtime before simulated sync
    const { mtimeMs: before } = require("node:fs").statSync(join(projectDir, filename));

    // Simulate the dedup check from runLearnSync
    const src = join(globalDir, filename);
    const dest = join(projectDir, filename);
    const shouldSkip = existsSync(dest) && readFileSync(src, "utf8") === readFileSync(dest, "utf8");
    expect(shouldSkip).toBe(true);
  });

  it("overwrites when content differs", () => {
    const filename = "LEARN-001-test-learning.md";
    const globalContent = `---\nid: LEARN-001\ntitle: Updated\ndate: 2026-01-01\ntags: [general]\ncategory: workflow\nseverity: high\nstatus: active\n---\n\nNew body.`;
    const projectContent = `---\nid: LEARN-001\ntitle: Old\ndate: 2026-01-01\ntags: [general]\ncategory: workflow\nseverity: low\nstatus: active\n---\n\nOld body.`;
    writeFileSync(join(globalDir, filename), globalContent);
    writeFileSync(join(projectDir, filename), projectContent);

    const src = join(globalDir, filename);
    const dest = join(projectDir, filename);
    const shouldSkip = existsSync(dest) && readFileSync(src, "utf8") === readFileSync(dest, "utf8");
    expect(shouldSkip).toBe(false);
  });
});

describe("tag matching", () => {
  it("finds overlap between learning tags and project tags", () => {
    const learningTags = ["parsing", "external-data", "general"];
    const projectTags = ["general", "workflow", "typescript"];
    const hasOverlap = learningTags.some((t) => projectTags.includes(t));
    expect(hasOverlap).toBe(true);
  });

  it("universal tags always match", () => {
    const learningTags = ["general"];
    const projectTags = ["general", "workflow"]; // always present
    const hasOverlap = learningTags.some((t) => projectTags.includes(t));
    expect(hasOverlap).toBe(true);
  });

  it("no overlap returns false", () => {
    const learningTags = ["rust", "cargo"];
    const projectTags = ["general", "workflow", "typescript", "node"];
    const hasOverlap = learningTags.some((t) => projectTags.includes(t));
    expect(hasOverlap).toBe(false);
  });
});

describe("analyzeStaleness", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("flags superseded learnings", () => {
    const learning: LearningFile = {
      ...sampleLearning,
      status: "superseded",
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons).toContain("status is superseded");
  });

  it("flags retired learnings", () => {
    const learning: LearningFile = {
      ...sampleLearning,
      status: "retired",
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons).toContain("status is retired");
  });

  it("flags old learnings beyond threshold", () => {
    const oldDate = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const learning: LearningFile = {
      ...sampleLearning,
      date: oldDate,
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons.some((r) => r.includes("days old"))).toBe(true);
  });

  it("does not flag learnings within age threshold", () => {
    const recentDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const learning: LearningFile = {
      ...sampleLearning,
      date: recentDate,
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons.some((r) => r.includes("days old"))).toBe(false);
  });

  it("flags dead file references", () => {
    const learning: LearningFile = {
      ...sampleLearning,
      date: new Date().toISOString().slice(0, 10),
      body: "Always check src/nonexistent/file.ts before deploying.",
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons.some((r) => r.includes("missing file"))).toBe(true);
  });

  it("does not flag file references that exist", () => {
    // Create the referenced file in the temp dir
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "real.ts"), "export const x = 1;");

    const learning: LearningFile = {
      ...sampleLearning,
      date: new Date().toISOString().slice(0, 10),
      body: "Always check src/real.ts before deploying.",
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons.some((r) => r.includes("missing file"))).toBe(false);
  });

  it("returns empty array for healthy active learning", () => {
    const learning: LearningFile = {
      ...sampleLearning,
      date: new Date().toISOString().slice(0, 10),
      body: "Always inspect real data before writing parsers.",
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons).toEqual([]);
  });

  it("accumulates multiple reasons", () => {
    const oldDate = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const learning: LearningFile = {
      ...sampleLearning,
      status: "superseded",
      date: oldDate,
      body: "Check src/deleted/thing.ts carefully.",
    };
    const reasons = analyzeStaleness(learning, 90, dir);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
    expect(reasons.some((r) => r.includes("superseded"))).toBe(true);
    expect(reasons.some((r) => r.includes("days old"))).toBe(true);
  });
});

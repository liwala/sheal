import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { applyDecisions } from "../src/consolidate/apply.js";
import type { DecisionsFile } from "../src/consolidate/apply.js";
import { lintLearnings } from "../src/learn/lint.js";
import { readLearning } from "../src/learn/store.js";

const repoRoot = process.cwd();
const tsxLoader = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

function writeLearningFile(
  dir: string,
  filename: string,
  fields: { id: string; title: string; body: string; status?: string },
): void {
  writeFileSync(
    join(dir, filename),
    `---
id: ${fields.id}
title: ${fields.title}
date: 2026-07-06
tags: [general]
category: workflow
severity: medium
status: ${fields.status ?? "active"}
---

${fields.body}
`,
    "utf-8",
  );
}

describe("consolidate apply", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeStore(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-consolidate-apply-"));
    const dir = join(tmp, ".sheal", "learnings");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of readdirSync(dir).sort()) {
      out[f] = readFileSync(join(dir, f), "utf-8");
    }
    return out;
  }

  it("dry-run (default) reports the plan without mutating the store", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-keep.md", {
      id: "LEARN-001",
      title: "Keep me",
      body: "When X happens, do Y before Z.",
    });
    const before = snapshot(dir);

    const decisions: DecisionsFile = {
      decisions: [
        { action: "retire", file: "LEARN-001-keep.md", reason: "test retire" },
      ],
    };
    const result = applyDecisions(dir, decisions, { apply: false });

    expect(result.applied).toBe(false);
    expect(result.planned).toHaveLength(1);
    expect(snapshot(dir)).toEqual(before);
  });

  it("renumber rewrites the id in frontmatter and filename to a free id", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-first.md", {
      id: "LEARN-001",
      title: "First learning",
      body: "When A, do B.",
    });
    writeLearningFile(dir, "LEARN-001-second.md", {
      id: "LEARN-001",
      title: "Second learning",
      body: "When C, do D.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        { action: "renumber", file: "LEARN-001-second.md", toId: "LEARN-002" },
      ],
    };
    const result = applyDecisions(dir, decisions, { apply: true });

    expect(result.applied).toBe(true);
    expect(existsSync(join(dir, "LEARN-001-second.md"))).toBe(false);
    const files = readdirSync(dir);
    const renamed = files.find((f) => f.startsWith("LEARN-002"));
    expect(renamed).toBeDefined();
    const learning = readLearning(join(dir, renamed!));
    expect(learning.id).toBe("LEARN-002");
    expect(learning.title).toBe("Second learning");
    expect(learning.body).toContain("When C, do D.");

    // The collision is gone
    const report = lintLearnings(dir);
    expect(report.findings.filter((f) => f.type === "duplicate-id")).toHaveLength(0);
  });

  it("renumber refuses a target id already used by a live learning", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-first.md", {
      id: "LEARN-001",
      title: "First learning",
      body: "When A, do B.",
    });
    writeLearningFile(dir, "LEARN-002-taken.md", {
      id: "LEARN-002",
      title: "Already here",
      body: "When E, do F.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        { action: "renumber", file: "LEARN-001-first.md", toId: "LEARN-002" },
      ],
    };
    expect(() => applyDecisions(dir, decisions, { apply: true })).toThrow(/LEARN-002/);
  });

  it("supersede sets status and appends a provenance pointer", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-003-old.md", {
      id: "LEARN-003",
      title: "Old rule",
      body: "When G, do H.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        {
          action: "supersede",
          file: "LEARN-003-old.md",
          by: "working-session-cadence rule 1 (docs/adr/0001-validation/working-session-cadence.md)",
        },
      ],
    };
    applyDecisions(dir, decisions, { apply: true });

    const learning = readLearning(join(dir, "LEARN-003-old.md"));
    expect(learning.status).toBe("superseded");
    expect(learning.body).toContain("When G, do H.");
    expect(learning.body).toContain("**Superseded by:** working-session-cadence rule 1");
  });

  it("retire sets status and appends the reason", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-004-feedback.md", {
      id: "LEARN-004",
      title: "Retro input completeness",
      body: "When retro input is incomplete, note the gaps.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        {
          action: "retire",
          file: "LEARN-004-feedback.md",
          reason: "product feedback, not an agent-behavior rule",
        },
      ],
    };
    applyDecisions(dir, decisions, { apply: true });

    const learning = readLearning(join(dir, "LEARN-004-feedback.md"));
    expect(learning.status).toBe("retired");
    expect(learning.body).toContain("**Retired:** product feedback, not an agent-behavior rule");
  });

  it("rewrite replaces title and body, keeps the learning live, and re-slugs the filename", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-005-vague.md", {
      id: "LEARN-005",
      title: "Filter collections at the data layer",
      body: "Filter collections at the data layer, not in the presentation layer.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        {
          action: "rewrite",
          file: "LEARN-005-vague.md",
          title: "Apply collection filters in the data layer",
          body: "When adding filter/search/sort over a collection in UI code, apply it in the data/query layer, not in the render path.",
        },
      ],
    };
    applyDecisions(dir, decisions, { apply: true });

    expect(existsSync(join(dir, "LEARN-005-vague.md"))).toBe(false);
    const renamed = readdirSync(dir).find((f) => f.startsWith("LEARN-005"));
    expect(renamed).toBeDefined();
    const learning = readLearning(join(dir, renamed!));
    expect(learning.id).toBe("LEARN-005");
    expect(learning.status).toBe("active");
    expect(learning.title).toBe("Apply collection filters in the data layer");
    expect(learning.body).toContain("When adding filter/search/sort");
  });

  it("supersede then renumber on the same file applies both (collision member that also retires)", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-keep.md", {
      id: "LEARN-001",
      title: "Survivor",
      body: "When A, do B.",
    });
    writeLearningFile(dir, "LEARN-001-dup.md", {
      id: "LEARN-001",
      title: "Absorbed duplicate",
      body: "When A, also do B.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        { action: "supersede", file: "LEARN-001-dup.md", by: "ground-truth rule 1" },
        { action: "renumber", file: "LEARN-001-dup.md", toId: "LEARN-002" },
      ],
    };
    applyDecisions(dir, decisions, { apply: true });

    const renamed = readdirSync(dir).find((f) => f.startsWith("LEARN-002"));
    expect(renamed).toBeDefined();
    const learning = readLearning(join(dir, renamed!));
    expect(learning.id).toBe("LEARN-002");
    expect(learning.status).toBe("superseded");
    expect(learning.body).toContain("**Superseded by:** ground-truth rule 1");

    const report = lintLearnings(dir);
    expect(report.findings.filter((f) => f.type === "duplicate-id")).toHaveLength(0);
  });

  it("rejects two renumbers claiming the same target id", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-first.md", {
      id: "LEARN-001",
      title: "First",
      body: "When A, do B.",
    });
    writeLearningFile(dir, "LEARN-001-second.md", {
      id: "LEARN-001",
      title: "Second",
      body: "When C, do D.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        { action: "renumber", file: "LEARN-001-first.md", toId: "LEARN-002" },
        { action: "renumber", file: "LEARN-001-second.md", toId: "LEARN-002" },
      ],
    };
    expect(() => applyDecisions(dir, decisions, { apply: true })).toThrow(/LEARN-002/);
    const report = lintLearnings(dir);
    expect(report.findings.filter((f) => f.type === "duplicate-id")).toHaveLength(1);
  });

  it("rejects a decision referencing a file renamed by an earlier decision", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-target.md", {
      id: "LEARN-001",
      title: "Target",
      body: "When A, do B.",
    });
    const before = snapshot(dir);

    const decisions: DecisionsFile = {
      decisions: [
        { action: "renumber", file: "LEARN-001-target.md", toId: "LEARN-002" },
        { action: "supersede", file: "LEARN-001-target.md", by: "some rule" },
      ],
    };
    expect(() => applyDecisions(dir, decisions, { apply: true })).toThrow(/renamed|renumber/i);
    expect(snapshot(dir)).toEqual(before);
  });

  it("re-applying the same supersede and retire decisions is idempotent", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-old.md", {
      id: "LEARN-001",
      title: "Old rule",
      body: "When A, do B.",
    });
    writeLearningFile(dir, "LEARN-002-feedback.md", {
      id: "LEARN-002",
      title: "Feedback",
      body: "When C, do D.",
    });

    const decisions: DecisionsFile = {
      decisions: [
        { action: "supersede", file: "LEARN-001-old.md", by: "rule 1" },
        { action: "retire", file: "LEARN-002-feedback.md", reason: "product feedback" },
      ],
    };
    applyDecisions(dir, decisions, { apply: true });
    const first = snapshot(dir);
    applyDecisions(dir, decisions, { apply: true });
    expect(snapshot(dir)).toEqual(first);

    const body = readLearning(join(dir, "LEARN-001-old.md")).body;
    expect(body.match(/\*\*Superseded by:\*\*/g)).toHaveLength(1);
  });

  it("rejects file references that escape the store directory", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-001-real.md", {
      id: "LEARN-001",
      title: "Real learning",
      body: "When M, do N.",
    });
    writeFileSync(join(dir, "..", "outside.md"), "not a learning", "utf-8");

    const decisions: DecisionsFile = {
      decisions: [
        { action: "retire", file: "../outside.md", reason: "escape attempt" },
      ],
    };
    expect(() => applyDecisions(dir, decisions, { apply: true })).toThrow(/outside\.md/);
    expect(readFileSync(join(dir, "..", "outside.md"), "utf-8")).toBe("not a learning");
  });

  it("a decision referencing a missing file fails the whole run with no partial mutation", () => {
    const dir = makeStore();
    writeLearningFile(dir, "LEARN-006-real.md", {
      id: "LEARN-006",
      title: "Real learning",
      body: "When I, do J.",
    });
    const before = snapshot(dir);

    const decisions: DecisionsFile = {
      decisions: [
        { action: "retire", file: "LEARN-006-real.md", reason: "valid decision" },
        { action: "retire", file: "LEARN-099-ghost.md", reason: "missing file" },
      ],
    };
    expect(() => applyDecisions(dir, decisions, { apply: true })).toThrow(/LEARN-099-ghost\.md/);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("sheal consolidate --decisions (CLI)", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeProject(): { projectRoot: string; dir: string } {
    tmp = mkdtempSync(join(tmpdir(), "sheal-consolidate-apply-cli-"));
    const dir = join(tmp, ".sheal", "learnings");
    mkdirSync(dir, { recursive: true });
    return { projectRoot: tmp, dir };
  }

  function runCli(projectRoot: string, extraArgs: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src", "index.ts"), "consolidate", "-p", projectRoot, ...extraArgs],
      { encoding: "utf-8" },
    );
  }

  it("dry-runs by default and mutates only with --apply", () => {
    const { projectRoot, dir } = makeProject();
    writeLearningFile(dir, "LEARN-001-cli.md", {
      id: "LEARN-001",
      title: "CLI target",
      body: "When K, do L.",
    });
    const decisionsPath = join(projectRoot, "decisions.json");
    writeFileSync(
      decisionsPath,
      JSON.stringify({
        decisions: [{ action: "retire", file: "LEARN-001-cli.md", reason: "cli test" }],
      }),
      "utf-8",
    );

    const dryRun = runCli(projectRoot, ["--decisions", decisionsPath]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("dry run");
    expect(readLearning(join(dir, "LEARN-001-cli.md")).status).toBe("active");

    const applied = runCli(projectRoot, ["--decisions", decisionsPath, "--apply"]);
    expect(applied.status).toBe(0);
    expect(readLearning(join(dir, "LEARN-001-cli.md")).status).toBe("retired");
  });

  it("exits non-zero on an invalid decisions file", () => {
    const { projectRoot } = makeProject();
    const decisionsPath = join(projectRoot, "decisions.json");
    writeFileSync(decisionsPath, JSON.stringify({ decisions: [{ action: "explode" }] }), "utf-8");

    const result = runCli(projectRoot, ["--decisions", decisionsPath, "--apply"]);
    expect(result.status).not.toBe(0);
  });
});

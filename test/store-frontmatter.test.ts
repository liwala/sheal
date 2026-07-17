import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLearning, renderLearning, parseLearningContent } from "../src/learn/store.js";
import { applyDecisions } from "../src/consolidate/apply.js";

describe("store frontmatter round-trip", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeStore(): string {
    tmp = mkdtempSync(join(tmpdir(), "sheal-store-frontmatter-"));
    const dir = join(tmp, "learnings");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  const CONTENT = `---
id: LEARN-001
title: A learning
date: 2026-07-09
tags: [general]
category: workflow
severity: medium
status: active
first-seen: 2026-06-01
confidence: 0.8
---

When A happens, do B.
`;

  it("parse → render preserves unknown frontmatter keys", () => {
    const learning = parseLearningContent(CONTENT);
    const rendered = renderLearning(learning);
    expect(rendered).toContain("first-seen: 2026-06-01");
    expect(rendered).toContain("confidence: 0.8");
    // Known fields still round-trip
    const reparsed = parseLearningContent(rendered);
    expect(reparsed.id).toBe("LEARN-001");
    expect(reparsed.status).toBe("active");
    expect(reparsed.body).toBe("When A happens, do B.");
  });

  it("unknown keys survive a supersede applied via the apply stage", () => {
    const dir = makeStore();
    writeFileSync(join(dir, "LEARN-001-a-learning.md"), CONTENT, "utf-8");

    applyDecisions(
      dir,
      { decisions: [{ action: "supersede", file: "LEARN-001-a-learning.md", by: "rule 1" }] },
      { apply: true },
    );

    const raw = readFileSync(join(dir, "LEARN-001-a-learning.md"), "utf-8");
    expect(raw).toContain("first-seen: 2026-06-01");
    expect(raw).toContain("confidence: 0.8");
    const learning = readLearning(join(dir, "LEARN-001-a-learning.md"));
    expect(learning.status).toBe("superseded");
    expect(learning.body).toContain("**Superseded by:** rule 1");
  });

  it("session-id keeps its dedicated field and does not duplicate as an unknown key", () => {
    const withSession = CONTENT.replace("status: active", "status: active\nsession-id: abc-123");
    const learning = parseLearningContent(withSession);
    expect(learning.sessionId).toBe("abc-123");
    const rendered = renderLearning(learning);
    expect(rendered.match(/session-id:/g)).toHaveLength(1);
  });
});

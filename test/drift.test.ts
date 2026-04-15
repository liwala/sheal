import { describe, it, expect } from "vitest";
import { detectDrift, parseRecurringFromEnrichment } from "../src/drift/detector.js";
import type { LearningFile } from "../src/learn/types.js";
import type { Retrospective } from "../src/retro/types.js";

function makeLearning(overrides: Partial<LearningFile> = {}): LearningFile {
  return {
    id: "LEARN-001",
    title: "Don't retry the same failing tool call",
    date: "2026-01-01",
    tags: ["workflow"],
    category: "workflow",
    severity: "medium",
    status: "active",
    body: "If a tool call fails twice with the same error, try an alternative approach instead of retrying.",
    ...overrides,
  };
}

function makeRetro(overrides: Partial<Retrospective> = {}): Retrospective {
  return {
    checkpointId: "abc123",
    sessionId: "sess-001",
    createdAt: "2026-01-15",
    effort: {
      entryCounts: {},
      toolCounts: {},
      fileTouchCounts: {},
      userPromptCount: 10,
      assistantResponseCount: 10,
    },
    failureLoops: [],
    revertedWork: [],
    learnings: [],
    healthScore: 80,
    ...overrides,
  };
}

describe("drift detection", () => {
  it("reports no drift when no violations found", () => {
    const learnings = [makeLearning()];
    const retros = [makeRetro()];
    const report = detectDrift(learnings, retros);
    expect(report.drifted).toHaveLength(0);
    expect(report.healthy).toHaveLength(1);
    expect(report.sessionsAnalyzed).toBe(1);
  });

  it("detects drift from failure loops matching retry-related learnings", () => {
    const learnings = [makeLearning({
      body: "If a tool call fails twice, try a different approach instead of retrying the same call.",
    })];
    const retros = [makeRetro({
      failureLoops: [{ action: "Read", retryCount: 5, entries: [], errorPattern: "file not found" }],
    })];
    const report = detectDrift(learnings, retros);
    expect(report.drifted).toHaveLength(1);
    expect(report.drifted[0].learning.id).toBe("LEARN-001");
    expect(report.drifted[0].violations[0].category).toBe("failure-loop");
  });

  it("detects drift from enrichment Recurring section", () => {
    const learnings = [makeLearning({ id: "LEARN-042" })];
    const retros = [makeRetro()];
    const enrichments = [{
      sessionId: "sess-001",
      content: "**Recurring:** LEARN-042 was violated again — same retry pattern observed.",
    }];
    const report = detectDrift(learnings, retros, enrichments);
    expect(report.drifted).toHaveLength(1);
    expect(report.drifted[0].violations[0].evidence).toContain("LLM flagged");
  });

  it("ignores draft learnings", () => {
    const learnings = [makeLearning({ status: "draft" })];
    const retros = [makeRetro({
      failureLoops: [{ action: "Read", retryCount: 5, entries: [], errorPattern: "error" }],
    })];
    const report = detectDrift(learnings, retros);
    expect(report.drifted).toHaveLength(0);
    expect(report.healthy).toHaveLength(0); // draft filtered out entirely
  });

  it("handles empty inputs gracefully", () => {
    expect(detectDrift([], []).drifted).toHaveLength(0);
    expect(detectDrift([], []).sessionsAnalyzed).toBe(0);
    expect(detectDrift([makeLearning()], []).sessionsAnalyzed).toBe(0);
  });
});

describe("parseRecurringFromEnrichment", () => {
  it("extracts LEARN-NNN references from Recurring section", () => {
    const content = `**Summary:** Good session.

**Recurring:** LEARN-005 was violated — no upfront plan. LEARN-018 also recurred with retry loops.

**Rules:**
- Do X before Y.`;
    const result = parseRecurringFromEnrichment(content);
    expect(result).toHaveLength(2);
    expect(result[0].learningId).toBe("LEARN-005");
    expect(result[1].learningId).toBe("LEARN-018");
  });

  it("returns empty for None recurring", () => {
    const content = "**Recurring:** None\n\n**Rules:**";
    expect(parseRecurringFromEnrichment(content)).toHaveLength(0);
  });

  it("returns empty when no Recurring section", () => {
    const content = "**Summary:** Just a summary.";
    expect(parseRecurringFromEnrichment(content)).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { buildSummary, resultHasWarnings } from "../src/output/json.js";
import type { CheckResult } from "../src/checkers/types.js";

// T17: --strict exits non-zero on detail-level warnings, so the report
// summary must count them the same way — one predicate for both.
describe("check summary warning definition", () => {
  const passWithWarnDetail: CheckResult = {
    name: "environment",
    label: "Environment",
    severity: "pass",
    details: [
      { message: "gh available", severity: "pass" },
      { message: "gh not authenticated", severity: "warn" },
    ],
    durationMs: 5,
  };

  const cleanPass: CheckResult = {
    name: "git",
    label: "Git",
    severity: "pass",
    details: [{ message: "clean", severity: "pass" }],
    durationMs: 3,
  };

  it("counts a pass-severity checker with warn details as a warning", () => {
    const summary = buildSummary([passWithWarnDetail, cleanPass]);

    expect(summary.warnings).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.healthy).toBe(true);
  });

  it("resultHasWarnings agrees with the strict exit predicate", () => {
    expect(resultHasWarnings(passWithWarnDetail)).toBe(true);
    expect(resultHasWarnings(cleanPass)).toBe(false);
  });
});

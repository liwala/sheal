import type { CheckResult } from "../checkers/types.js";

/**
 * One shared definition of "this result carries warnings", used by both the
 * report summary and `check --strict`'s exit decision — a checker can pass
 * overall while individual details warn (T17).
 */
export function resultHasWarnings(result: CheckResult): boolean {
  return result.severity === "warn" || result.details.some((d) => d.severity === "warn");
}

export function buildSummary(results: CheckResult[]) {
  return {
    total: results.length,
    passed: results.filter((r) => r.severity === "pass" && !resultHasWarnings(r)).length,
    warnings: results.filter(resultHasWarnings).length,
    failed: results.filter((r) => r.severity === "fail").length,
    skipped: results.filter((r) => r.severity === "skip").length,
    healthy: results.every((r) => r.severity !== "fail"),
  };
}

export function outputJson(results: CheckResult[]): void {
  console.log(JSON.stringify({ summary: buildSummary(results), checks: results }, null, 2));
}

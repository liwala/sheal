import type { CheckResult } from "../checkers/types.js";

export function outputJson(results: CheckResult[]): void {
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.severity === "pass").length,
    warnings: results.filter((r) => r.severity === "warn").length,
    failed: results.filter((r) => r.severity === "fail").length,
    skipped: results.filter((r) => r.severity === "skip").length,
    healthy: results.every((r) => r.severity !== "fail"),
  };

  console.log(JSON.stringify({ summary, checks: results }, null, 2));
}

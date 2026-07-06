import chalk from "chalk";
import type { CheckResult, Severity } from "../checkers/types.js";
import { buildSummary } from "./json.js";

const icons: Record<Severity, string> = {
  pass: chalk.green("✓"),
  warn: chalk.yellow("!"),
  fail: chalk.red("✗"),
  skip: chalk.gray("○"),
};

const colors: Record<Severity, (s: string) => string> = {
  pass: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
  skip: chalk.gray,
};

export function outputPretty(results: CheckResult[]): void {
  console.log();
  console.log(chalk.bold("Pre-Session Health Check"));
  console.log(chalk.gray("─".repeat(40)));

  for (const result of results) {
    const icon = icons[result.severity];
    const color = colors[result.severity];
    console.log(`${icon} ${color(result.label)} ${chalk.gray(`(${result.durationMs}ms)`)}`);

    for (const detail of result.details) {
      const detailIcon = icons[detail.severity];
      console.log(`  ${detailIcon} ${detail.message}`);
    }
  }

  console.log(chalk.gray("─".repeat(40)));

  // Same predicate as the JSON summary and --strict's exit code (T17/T18):
  // detail-level warnings count, so the terminal never contradicts the gate.
  const summary = buildSummary(results);

  const parts: string[] = [];
  if (summary.passed) parts.push(chalk.green(`${summary.passed} passed`));
  if (summary.warnings) parts.push(chalk.yellow(`${summary.warnings} warnings`));
  if (summary.failed) parts.push(chalk.red(`${summary.failed} failed`));
  if (summary.skipped) parts.push(chalk.gray(`${summary.skipped} skipped`));

  const totalMs = results.reduce((sum, r) => Math.max(sum, r.durationMs), 0);
  console.log(`${results.length} checks: ${parts.join(", ")} ${chalk.gray(`(${totalMs}ms)`)}`);
  console.log();
}

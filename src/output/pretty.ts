import chalk from "chalk";
import type { CheckResult, Severity } from "../checkers/types.js";

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

  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.severity]++;

  const parts: string[] = [];
  if (counts.pass) parts.push(chalk.green(`${counts.pass} passed`));
  if (counts.warn) parts.push(chalk.yellow(`${counts.warn} warnings`));
  if (counts.fail) parts.push(chalk.red(`${counts.fail} failed`));
  if (counts.skip) parts.push(chalk.gray(`${counts.skip} skipped`));

  const totalMs = results.reduce((sum, r) => Math.max(sum, r.durationMs), 0);
  console.log(`${results.length} checks: ${parts.join(", ")} ${chalk.gray(`(${totalMs}ms)`)}`);
  console.log();
}

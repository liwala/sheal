import { allCheckers } from "../checkers/index.js";
import type { CheckResult, CheckerContext } from "../checkers/types.js";
import { loadConfig } from "../config/loader.js";
import { outputPretty } from "../output/pretty.js";
import { outputJson } from "../output/json.js";

export interface CheckOptions {
  format: string;
  projectRoot: string;
  skip?: string;
}

export async function runCheck(options: CheckOptions): Promise<void> {
  const config = loadConfig(options.projectRoot);
  const format = options.format ?? config.format;

  // Merge --skip flag into config
  const skipList = [
    ...config.skip,
    ...(options.skip ? options.skip.split(",").map((s) => s.trim()) : []),
  ];

  const checkers = allCheckers.filter((c) => !skipList.includes(c.name));
  const ctx: CheckerContext = { projectRoot: options.projectRoot, config };

  // Run all checkers in parallel
  const results: CheckResult[] = await Promise.all(
    checkers.map(async (checker) => {
      try {
        return await Promise.race([
          checker.run(ctx),
          new Promise<CheckResult>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), config.timeoutMs),
          ),
        ]);
      } catch {
        return {
          name: checker.name,
          label: checker.label,
          severity: "fail" as const,
          details: [{ message: "Checker timed out or crashed", severity: "fail" as const }],
          durationMs: config.timeoutMs,
        };
      }
    }),
  );

  if (format === "json") {
    outputJson(results);
  } else {
    outputPretty(results);
  }

  const hasFail = results.some((r) => r.severity === "fail");
  // Use process.exit to prevent hanging from lingering child processes
  process.exit(hasFail ? 1 : 0);
}

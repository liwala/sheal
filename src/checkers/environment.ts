import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { exec } from "../utils/exec.js";
import { startTimer } from "../utils/timer.js";

export const environmentChecker: Checker = {
  name: "environment",
  label: "Environment",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const details: CheckDetail[] = [];
    const envConfig = ctx.config.checkers.environment;

    // Check .env file
    const envFile = join(ctx.projectRoot, ".env");
    if (existsSync(envFile)) {
      details.push({ message: ".env file present", severity: "pass" });
    } else {
      const envExample = existsSync(join(ctx.projectRoot, ".env.example"));
      if (envExample) {
        details.push({ message: ".env.example exists but .env is missing — copy and configure it", severity: "warn" });
      }
    }

    // Check required env vars
    if (envConfig.requiredVars.length > 0) {
      const missing = envConfig.requiredVars.filter((v: string) => !process.env[v]);
      if (missing.length > 0) {
        details.push({
          message: `Missing environment variables: ${missing.join(", ")}`,
          severity: "fail",
          data: { missing },
        });
      } else {
        details.push({
          message: `All ${envConfig.requiredVars.length} required env vars set`,
          severity: "pass",
        });
      }
    }

    // Check required services
    for (const svc of envConfig.requiredServices) {
      const parts = svc.check.split(" ");
      const result = await exec(parts[0], parts.slice(1), { cwd: ctx.projectRoot, timeoutMs: 3_000 });
      if (result.exitCode === 0) {
        details.push({ message: `Service "${svc.name}" is running`, severity: "pass" });
      } else {
        details.push({
          message: `Service "${svc.name}" is not reachable`,
          severity: "fail",
          data: { check: svc.check, stderr: result.stderr.slice(0, 200) },
        });
      }
    }

    // Check for useful dev tools
    const devTools = [
      { cmd: "gh", args: ["--version"], name: "GitHub CLI (gh)", hint: "install: brew install gh" },
    ];
    for (const tool of devTools) {
      const result = await exec(tool.cmd, tool.args, { cwd: ctx.projectRoot, timeoutMs: 3_000 });
      if (result.exitCode === 0) {
        details.push({ message: `${tool.name} available`, severity: "pass" });
        // Also check if gh is authenticated
        if (tool.cmd === "gh") {
          const auth = await exec("gh", ["auth", "status"], { cwd: ctx.projectRoot, timeoutMs: 5_000 });
          if (auth.exitCode === 0) {
            details.push({ message: "gh authenticated", severity: "pass" });
          } else {
            details.push({ message: "gh not authenticated — run: gh auth login", severity: "warn" });
          }
        }
      } else {
        details.push({ message: `${tool.name} not found — ${tool.hint}`, severity: "warn" });
      }
    }

    if (details.length === 0) {
      return {
        name: this.name, label: this.label, severity: "skip",
        details: [{ message: "No environment checks configured", severity: "skip" }],
        durationMs: elapsed(),
      };
    }

    const worst = details.some((d) => d.severity === "fail") ? "fail"
      : details.some((d) => d.severity === "warn") ? "warn" : "pass";

    return { name: this.name, label: this.label, severity: worst as CheckResult["severity"], details, durationMs: elapsed() };
  },
};

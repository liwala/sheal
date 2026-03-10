import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { startTimer } from "../utils/timer.js";

const DEFAULT_LEARNING_FILES = [
  "CLAUDE.md",
  ".cursorrules",
  "AGENTS.md",
  ".github/copilot-instructions.md",
  ".self-heal.json",
  ".gemini/GEMINI.md",
];

export const sessionLearningsChecker: Checker = {
  name: "session-learnings",
  label: "Session Learnings",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const details: CheckDetail[] = [];

    const extraFiles = ctx.config.checkers.sessionLearnings.files;
    const allFiles = [...DEFAULT_LEARNING_FILES, ...extraFiles];

    const found: string[] = [];
    for (const file of allFiles) {
      const fullPath = join(ctx.projectRoot, file);
      if (existsSync(fullPath)) {
        found.push(file);
        details.push({ message: `Found: ${file}`, severity: "pass", data: { file } });
      }
    }

    if (found.length === 0) {
      details.push({
        message: "No AI session learning files detected. Consider adding CLAUDE.md or .cursorrules",
        severity: "warn",
      });
    }

    const severity = found.length > 0 ? "pass" : "warn";
    return { name: this.name, label: this.label, severity, details, durationMs: elapsed() };
  },
};

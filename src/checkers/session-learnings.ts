import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { startTimer } from "../utils/timer.js";
import { listLearnings, getGlobalDir, getProjectDir } from "../learn/store.js";
import type { LearningFile } from "../learn/types.js";

const DEFAULT_LEARNING_FILES = [
  "CLAUDE.md",
  ".cursorrules",
  "AGENTS.md",
  ".github/copilot-instructions.md",
  ".self-heal.json",
  ".gemini/GEMINI.md",
];

const SEVERITY_ICON: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🔵",
};

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

    // Surface active learnings from project and global stores
    const projectLearnings = listLearnings(getProjectDir(ctx.projectRoot));
    const globalLearnings = listLearnings(getGlobalDir());

    const active = [...projectLearnings, ...globalLearnings].filter((l) => l.status === "active");

    if (active.length > 0) {
      // Deduplicate by ID
      const seen = new Set<string>();
      const unique: LearningFile[] = [];
      for (const l of active) {
        if (!seen.has(l.id)) {
          seen.add(l.id);
          unique.push(l);
        }
      }

      // Show high-severity learnings prominently
      const high = unique.filter((l) => l.severity === "high");
      const medium = unique.filter((l) => l.severity === "medium");
      const low = unique.filter((l) => l.severity === "low");

      if (high.length > 0) {
        for (const l of high) {
          details.push({
            message: `${SEVERITY_ICON.high} ${l.id}: ${l.body.split("\n")[0].slice(0, 100)}`,
            severity: "warn",
            data: { id: l.id, category: l.category, tags: l.tags },
          });
        }
      }

      if (medium.length > 0) {
        for (const l of medium) {
          details.push({
            message: `${SEVERITY_ICON.medium} ${l.id}: ${l.body.split("\n")[0].slice(0, 100)}`,
            severity: "pass",
            data: { id: l.id, category: l.category, tags: l.tags },
          });
        }
      }

      if (low.length > 0) {
        details.push({
          message: `${low.length} low-severity learning(s) — run 'sheal learn list' to view`,
          severity: "pass",
        });
      }
    }

    const hasHighLearnings = active.some((l) => l.severity === "high");
    const severity = found.length === 0 ? "warn"
      : hasHighLearnings ? "warn"
      : "pass";
    return { name: this.name, label: this.label, severity, details, durationMs: elapsed() };
  },
};

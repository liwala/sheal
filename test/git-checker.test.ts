import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { gitChecker, parseGitStatusCounts } from "../src/checkers/git.js";
import { defaultConfig } from "../src/config/defaults.js";

describe("gitChecker", () => {
  it("does not trim away the leading status column", () => {
    const counts = parseGitStatusCounts(" M package.json\n?? new-file.ts\n");
    expect(counts).toEqual({
      staged: 0,
      unstaged: 1,
      untracked: 1,
      totalChanged: 2,
    });
  });

  it("passes dirty worktrees when allowDirty is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sheal-git-checker-"));

    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "untracked.txt"), "local");

      const result = await gitChecker.run({
        projectRoot: dir,
        config: {
          ...defaultConfig,
          checkers: {
            ...defaultConfig.checkers,
            git: { allowDirty: true },
          },
        },
      });

      expect(result.severity).toBe("pass");
      expect(result.details.some((d) => d.message.includes("Uncommitted changes"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

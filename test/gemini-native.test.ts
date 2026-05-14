import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resolveProjectPathSync } from "../packages/agent-sessions/src/gemini.js";

describe("Gemini project path resolution", () => {
  it("resolves SHA-256 project directories from projects.json mapping", () => {
    const dir = mkdtempSync(join(tmpdir(), "sheal-gemini-test-"));
    const projectPath = "/Users/example/code/project-with-hash";
    const dirName = createHash("sha256").update(projectPath).digest("hex");

    try {
      const result = resolveProjectPathSync(
        dirName,
        dir,
        new Map([[projectPath, "project-with-hash"]])
      );
      expect(result).toBe(projectPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

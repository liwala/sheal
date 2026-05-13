import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dependenciesChecker } from "../src/checkers/dependencies.js";
import { defaultConfig } from "../src/config/defaults.js";

describe("dependenciesChecker", () => {
  it("uses npm install marker instead of node_modules directory mtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sheal-deps-checker-"));

    try {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "package-lock.json"), "{}");
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}");

      const oldDate = new Date("2026-01-01T00:00:00.000Z");
      const newDate = new Date("2026-01-02T00:00:00.000Z");
      utimesSync(join(dir, "node_modules"), oldDate, oldDate);
      utimesSync(join(dir, "package.json"), oldDate, oldDate);
      utimesSync(join(dir, "package-lock.json"), oldDate, oldDate);
      utimesSync(join(dir, "node_modules", ".package-lock.json"), newDate, newDate);

      const result = await dependenciesChecker.run({ projectRoot: dir, config: defaultConfig });
      expect(result.severity).toBe("pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

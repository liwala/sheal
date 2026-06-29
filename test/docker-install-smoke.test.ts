import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker install smoke automation", () => {
  it("is registered as an npm script and CI gate", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/ci.yml", "utf-8");

    expect(packageJson.scripts?.["smoke:install:docker"]).toBe(
      "bash scripts/smoke-npm-install-docker.sh",
    );
    expect(workflow).toContain("npm run smoke:install:docker");
  });
});

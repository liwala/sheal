import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("npm package", () => {
  it("bundles the unpublished agent-sessions workspace dependency", () => {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    const [pack] = JSON.parse(output) as Array<{ bundled?: string[] }>;

    expect(pack.bundled).toContain("@liwala/agent-sessions");
  });
});

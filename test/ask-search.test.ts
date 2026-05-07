import { describe, it, expect } from "vitest";
import { createKeywordPattern } from "../src/commands/ask.js";

function matches(term: string, text: string): boolean {
  return createKeywordPattern(term).test(text);
}

describe("createKeywordPattern", () => {
  it("keeps simple word boundaries for short commands", () => {
    expect(matches("bd", "run bd list")).toBe(true);
    expect(matches("bd", "embedded database")).toBe(false);
  });

  it("matches scoped package names and flags", () => {
    expect(matches("@liwala/agent-sessions", "import @liwala/agent-sessions here")).toBe(true);
    expect(matches("--format", "run sheal check --format json")).toBe(true);
  });

  it("matches dotfiles and paths", () => {
    expect(matches(".env", "inspect .env before running")).toBe(true);
    expect(matches("/tmp/sheal", "wrote output to /tmp/sheal")).toBe(true);
  });
});

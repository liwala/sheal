import { describe, it, expect } from "vitest";
import { pickLatestRetroCandidate } from "../src/commands/retro.js";

describe("pickLatestRetroCandidate", () => {
  it("chooses the newest session across sources", () => {
    const candidate = pickLatestRetroCandidate([
      {
        source: "claude-native",
        id: "claude-1",
        createdAt: "2026-04-21T16:00:32.043Z",
        title: "older claude session",
      },
      {
        source: "codex-native",
        id: "codex-1",
        createdAt: "2026-04-23T10:46:55.967Z",
        title: "current codex session",
      },
      {
        source: "entire",
        id: "entire-1",
        createdAt: "2026-04-22T08:15:00.000Z",
        title: "entire checkpoint",
      },
    ]);

    expect(candidate).toEqual({
      source: "codex-native",
      id: "codex-1",
      createdAt: "2026-04-23T10:46:55.967Z",
      title: "current codex session",
    });
  });

  it("returns null for an empty candidate list", () => {
    expect(pickLatestRetroCandidate([])).toBeNull();
  });
});

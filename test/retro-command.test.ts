import { describe, it, expect } from "vitest";
import { handleRetroRegistryImportOffer, pickLatestRetroCandidate } from "../src/commands/retro.js";
import type { Checkpoint } from "@liwala/agent-sessions";

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

describe("handleRetroRegistryImportOffer", () => {
  it("offers to import a live-home-only target before retro analysis", async () => {
    const messages: string[] = [];
    let imported = false;

    const result = await handleRetroRegistryImportOffer({
      projectRoot: "/tmp/project",
      checkpoint: checkpoint("codex-live", "Codex"),
      inventory: [
        {
          checkpointId: "codex-live",
          sessionId: "codex-live",
          createdAt: "2026-06-11T12:05:00.000Z",
          filesTouched: [],
          agent: "Codex",
          sessionCount: 1,
          sessionIds: ["codex-live"],
          registryStatus: "live-home-only",
          rawSessionId: "codex:codex-live",
        },
      ],
      confirmImport: async (message) => {
        messages.push(message);
        return true;
      },
      importSessions: () => {
        imported = true;
        return { rawSessionIds: ["codex:codex-live"] };
      },
      notify: (message) => messages.push(message),
    });

    expect(result).toBe("imported");
    expect(imported).toBe(true);
    expect(messages[0]).toContain("Codex session codex-live is not backed up");
    expect(messages).toContain("Added session to .sheal/sessions/raw/.");
  });

  it("continues with live-home behavior when import is declined", async () => {
    let imported = false;

    const result = await handleRetroRegistryImportOffer({
      projectRoot: "/tmp/project",
      checkpoint: checkpoint("claude-live", "Claude Code"),
      inventory: [
        {
          checkpointId: "claude-live",
          sessionId: "claude-live",
          createdAt: "2026-06-11T12:00:00.000Z",
          filesTouched: [],
          agent: "Claude Code",
          sessionCount: 1,
          sessionIds: ["claude-live"],
          registryStatus: "live-home-only",
          rawSessionId: "claude:claude-live",
        },
      ],
      confirmImport: async () => false,
      importSessions: () => {
        imported = true;
        return { rawSessionIds: ["claude:claude-live"] };
      },
      notify: () => {},
    });

    expect(result).toBe("declined");
    expect(imported).toBe(false);
  });
});

function checkpoint(sessionId: string, agent: string): Checkpoint {
  return {
    root: {
      checkpointId: sessionId,
      strategy: "native",
      checkpointsCount: 0,
      filesTouched: [],
      sessions: [],
    },
    sessions: [
      {
        metadata: {
          checkpointId: sessionId,
          sessionId,
          strategy: "native",
          createdAt: "2026-06-11T12:00:00.000Z",
          checkpointsCount: 0,
          filesTouched: [],
          agent,
        },
        transcript: [
          {
            uuid: "user-1",
            type: "user",
            timestamp: "2026-06-11T12:00:00.000Z",
            content: "do useful work",
          },
        ],
        prompts: ["do useful work"],
      },
    ],
  };
}

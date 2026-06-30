import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeSessionSource } from "../src/sessions/raw-registry.js";
import {
  formatSessionBackupBadge,
  getSessionImportOffer,
  listProjectSessionInventory,
} from "../src/sessions/inventory.js";

describe("project session inventory", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("classifies live-home sessions as registry-backed or live-home-only", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-session-inventory-"));
    const projectRoot = join(tmp, "project");
    const sourceRoot = join(tmp, "source");
    mkdirSync(projectRoot, { recursive: true });

    const claudeSessionId = "419c05f5-d385-473d-9571-e3a8b90281ab";
    const codexSessionId = "019eb769-5e17-75e3-8e5b-0965f97ba7f2";
    writeClaudeTranscript(sourceRoot, projectRoot, claudeSessionId, "backed up Claude session");

    expect(normalizeSessionSource({ projectRoot, sourceRoot }).rawSessionIds).toEqual([
      `claude:${claudeSessionId}`,
    ]);

    writeCodexTranscript(sourceRoot, projectRoot, codexSessionId, "not backed up Codex session");

    const inventory = listProjectSessionInventory(projectRoot, { sourceRoot });
    expect(inventory.map((item) => ({
      agent: item.agent,
      sessionId: item.sessionId,
      registryStatus: item.registryStatus,
      rawSessionId: item.rawSessionId,
      title: item.title,
    }))).toEqual([
      {
        agent: "Codex",
        sessionId: codexSessionId,
        registryStatus: "live-home-only",
        rawSessionId: `codex:${codexSessionId}`,
        title: "not backed up Codex session",
      },
      {
        agent: "Claude Code",
        sessionId: claudeSessionId,
        registryStatus: "registry-backed",
        rawSessionId: `claude:${claudeSessionId}`,
        title: "backed up Claude session",
      },
    ]);
  });

  it("formats browse backup status and startup import offer text", () => {
    const liveOnly = {
      checkpointId: "codex-live",
      sessionId: "codex-live",
      createdAt: "2026-06-11T12:05:00.000Z",
      filesTouched: [],
      agent: "Codex",
      sessionCount: 1,
      sessionIds: ["codex-live"],
      registryStatus: "live-home-only" as const,
      rawSessionId: "codex:codex-live",
    };
    const backed = {
      ...liveOnly,
      sessionId: "claude-backed",
      agent: "Claude Code",
      registryStatus: "registry-backed" as const,
      rawSessionId: "claude:claude-backed",
    };

    expect(formatSessionBackupBadge(liveOnly)).toBe("[not backed up]");
    expect(formatSessionBackupBadge(backed)).toBe("");
    expect(getSessionImportOffer([backed, liveOnly])).toBe(
      "1 live-home session is not backed up in the sheal registry yet. Press i to add it.",
    );
  });
});

function writeClaudeTranscript(sourceRoot: string, projectRoot: string, sessionId: string, prompt: string): void {
  const projectSlug = projectRoot.replace(/[\\/: ]/g, "-");
  const claudeDir = join(sourceRoot, ".claude", "projects", projectSlug);
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        uuid: "user-1",
        timestamp: "2026-06-11T12:00:00.000Z",
        sessionId,
        cwd: projectRoot,
        message: {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      }),
    ].join("\n") + "\n",
    "utf-8",
  );
}

function writeCodexTranscript(sourceRoot: string, projectRoot: string, sessionId: string, prompt: string): void {
  const codexDir = join(sourceRoot, ".codex", "sessions", "2026", "06", "11");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, `rollout-2026-06-11T12-05-00-${sessionId}.jsonl`),
    [
      JSON.stringify({
        timestamp: "2026-06-11T12:05:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          cwd: projectRoot,
          timestamp: "2026-06-11T12:05:00.000Z",
          model_provider: "openai",
          cli_version: "0.123.0",
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T12:05:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }),
    ].join("\n") + "\n",
    "utf-8",
  );
}

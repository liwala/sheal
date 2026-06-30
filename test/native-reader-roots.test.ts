import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listNativeSessions, loadNativeSession } from "../packages/agent-sessions/src/claude.js";
import { listCodexSessionsForProject, loadCodexSessionCheckpoint } from "../packages/agent-sessions/src/codex.js";

describe("native session readers with explicit roots", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("reads Claude project transcripts from an explicit .claude root", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-reader-root-"));
    const projectRoot = join(tmp, "project");
    const claudeRoot = join(tmp, "source", ".claude");
    const sessionId = "claude-explicit-root";
    const projectSlug = projectRoot.replace(/[\\/: ]/g, "-");
    mkdirSync(join(claudeRoot, "projects", projectSlug), { recursive: true });
    writeFileSync(
      join(claudeRoot, "projects", projectSlug, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          uuid: "u1",
          timestamp: "2026-06-11T10:00:00.000Z",
          sessionId,
          cwd: projectRoot,
          message: { role: "user", content: [{ type: "text", text: "read from explicit claude root" }] },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    expect(listNativeSessions(projectRoot, { root: claudeRoot })).toMatchObject([
      { checkpointId: sessionId, agent: "Claude Code", title: "read from explicit claude root" },
    ]);
    expect(loadNativeSession(projectRoot, sessionId, { root: claudeRoot })?.sessions[0].prompts).toEqual([
      "read from explicit claude root",
    ]);
  });

  it("reads Codex sessions from an explicit .codex root", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-reader-root-"));
    const projectRoot = join(tmp, "project");
    const codexRoot = join(tmp, "source", ".codex");
    const sessionId = "codex-explicit-root";
    mkdirSync(join(codexRoot, "sessions", "2026", "06", "11"), { recursive: true });
    writeFileSync(
      join(codexRoot, "sessions", "2026", "06", "11", `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-06-11T10:05:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            cwd: projectRoot,
            timestamp: "2026-06-11T10:05:00.000Z",
            model_provider: "openai",
            cli_version: "0.123.0",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-11T10:05:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "read from explicit codex root" }],
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    expect(listCodexSessionsForProject(projectRoot, { root: codexRoot })).toMatchObject([
      { checkpointId: sessionId, agent: "Codex", title: "read from explicit codex root" },
    ]);
    expect(loadCodexSessionCheckpoint(sessionId, projectRoot, { root: codexRoot })?.sessions[0].prompts).toEqual([
      "read from explicit codex root",
    ]);
  });
});

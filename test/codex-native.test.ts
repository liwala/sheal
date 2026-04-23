import { describe, it, expect } from "vitest";
import { codexSessionToCheckpoint } from "../src/entire/codex-native.js";

describe("codexSessionToCheckpoint", () => {
  it("normalizes Codex messages and tool calls for retro analysis", () => {
    const meta = {
      id: "019db9f3-30dd-7db3-bd89-004f3f7b5c96",
      path: "/tmp/rollout.jsonl",
      cwd: "/Users/lu/code/liwala/sheal",
      timestamp: "2026-04-23T10:46:55.967Z",
      model: "openai",
      cliVersion: "0.123.0",
      firstPrompt: "fix retros",
    };

    const content = [
      JSON.stringify({
        timestamp: "2026-04-23T10:46:55.967Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "# AGENTS.md instructions for /Users/lu/code/liwala/sheal" },
            { type: "input_text", text: "let's fix sheal retro for codex sessions" },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-23T10:47:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "I’m checking the retro loader." },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-23T10:47:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "npm test", workdir: "/Users/lu/code/liwala/sheal" }),
          call_id: "call-bash",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-23T10:47:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-bash",
          output: "Exit code 1\nError: test failed",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-23T10:47:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "apply_patch",
          arguments: JSON.stringify({
            code: "*** Begin Patch\n*** Update File: src/commands/retro.ts\n@@\n-old\n+new\n*** End Patch\n",
          }),
          call_id: "call-patch",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-23T10:47:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-patch",
          output: "Success. Updated the following files:\nM src/commands/retro.ts",
        },
      }),
    ].join("\n");

    const checkpoint = codexSessionToCheckpoint(meta, content);
    const session = checkpoint.sessions[0];

    expect(session.metadata.agent).toBe("Codex");
    expect(session.metadata.createdAt).toBe("2026-04-23T10:46:55.967Z");
    expect(session.prompts).toEqual(["let's fix sheal retro for codex sessions"]);
    expect(session.transcript[0].type).toBe("user");
    expect(session.transcript[0].content).toBe("let's fix sheal retro for codex sessions");
    expect(session.transcript[2].toolName).toBe("Bash");
    expect(session.transcript[2].toolInput).toEqual({
      command: "npm test",
      workdir: "/Users/lu/code/liwala/sheal",
    });
    expect(session.transcript[3].toolOutput).toContain("Exit code 1");
    expect(session.transcript[4].toolName).toBe("Edit");
    expect(session.transcript[4].filesAffected).toEqual(["src/commands/retro.ts"]);
    expect(session.metadata.filesTouched).toEqual(["src/commands/retro.ts"]);
  });
});

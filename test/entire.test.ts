import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTranscript } from "../src/entire/transcript.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("parseTranscript", () => {
  describe("Claude Code format", () => {
    const content = readFileSync(join(FIXTURES, "transcript-claude.jsonl"), "utf-8");

    it("parses all entries", () => {
      const entries = parseTranscript(content, "Claude Code");
      expect(entries.length).toBe(8);
    });

    it("identifies user messages", () => {
      const entries = parseTranscript(content, "Claude Code");
      const userEntries = entries.filter((e) => e.type === "user");
      expect(userEntries.length).toBe(1); // only the initial text prompt; tool_results become "tool" type
    });

    it("identifies assistant messages", () => {
      const entries = parseTranscript(content, "Claude Code");
      const assistantEntries = entries.filter((e) => e.type === "assistant");
      expect(assistantEntries.length).toBe(3);
    });

    it("identifies tool use entries", () => {
      const entries = parseTranscript(content, "Claude Code");
      const toolEntries = entries.filter((e) => e.type === "tool");
      expect(toolEntries.length).toBe(4); // 2 tool_use + 2 tool_result
    });

    it("extracts tool names", () => {
      const entries = parseTranscript(content, "Claude Code");
      const toolEntries = entries.filter((e) => e.toolName);
      expect(toolEntries.map((e) => e.toolName)).toEqual(["Read", "Edit"]);
    });

    it("extracts files affected by Edit tool", () => {
      const entries = parseTranscript(content, "Claude Code");
      const editEntry = entries.find((e) => e.toolName === "Edit");
      expect(editEntry?.filesAffected).toEqual(["/src/auth.ts"]);
    });

    it("extracts text content from assistant messages", () => {
      const entries = parseTranscript(content, "Claude Code");
      const firstAssistant = entries.find((e) => e.type === "assistant");
      expect(firstAssistant?.content).toContain("auth module");
    });

    it("auto-detects Claude format without agent hint", () => {
      const entries = parseTranscript(content);
      expect(entries.length).toBe(8);
      const toolEntries = entries.filter((e) => e.toolName);
      expect(toolEntries.map((e) => e.toolName)).toEqual(["Read", "Edit"]);
    });
  });

  describe("edge cases", () => {
    it("handles empty input", () => {
      const entries = parseTranscript("");
      expect(entries).toEqual([]);
    });

    it("skips malformed JSON lines", () => {
      const content = '{"role":"user","content":"hello"}\nnot-json\n{"role":"assistant","content":"hi"}';
      const entries = parseTranscript(content);
      expect(entries.length).toBe(2);
    });

    it("handles simple string content", () => {
      const content = '{"role":"user","content":"test message"}';
      const entries = parseTranscript(content);
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe("test message");
      expect(entries[0].type).toBe("user");
    });
  });
});

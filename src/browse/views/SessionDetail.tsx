import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadNativeSessionBySlug } from "../../entire/claude-native.js";
import type { SessionEntry } from "../../entire/types.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface SessionDetailProps {
  slug: string;
  sessionId: string;
  onBack: () => void;
  onQuit: () => void;
}

/** Collapse transcript into readable "blocks" — group consecutive tool entries, etc. */
interface DisplayBlock {
  type: "user" | "assistant" | "tool-group" | "system";
  lines: string[];
  /** Number of raw entries this block represents */
  entryCount: number;
}

export function SessionDetail({ slug, sessionId, onBack, onQuit }: SessionDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  const { checkpoint, blocks } = useMemo(() => {
    const cp = loadNativeSessionBySlug(slug, sessionId);
    if (!cp || cp.sessions.length === 0) return { checkpoint: null, blocks: [] };
    return { checkpoint: cp, blocks: buildBlocks(cp.sessions[0].transcript) };
  }, [slug, sessionId]);

  const filteredBlocks = useMemo(() => {
    if (!searchText) return blocks;
    const q = searchText.toLowerCase();
    return blocks.filter((b) =>
      b.lines.some((l) => l.toLowerCase().includes(q)),
    );
  }, [blocks, searchText]);

  useInput((input, key) => {
    if (searchActive) {
      if (key.escape) {
        setSearchActive(false);
        setSearchText("");
      } else if (key.return) {
        setSearchActive(false);
      }
      return;
    }

    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setSearchActive(true); return; }

    if (key.upArrow) {
      setScrollPos((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setScrollPos((p) => Math.min(Math.max(0, filteredBlocks.length - 1), p + 1));
    } else if (key.pageDown) {
      setScrollPos((p) => Math.min(Math.max(0, filteredBlocks.length - 1), p + Math.floor(maxRows / 3)));
    } else if (key.pageUp) {
      setScrollPos((p) => Math.max(0, p - Math.floor(maxRows / 3)));
    } else if (key.return) {
      // Toggle tool expansion
      setExpandedTools((prev) => {
        const next = new Set(prev);
        if (next.has(scrollPos)) next.delete(scrollPos);
        else next.add(scrollPos);
        return next;
      });
    }
  });

  if (!checkpoint) {
    return (
      <Box flexDirection="column">
        <Text color="red">Session not found: {sessionId}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const session = checkpoint.sessions[0];
  const meta = session.metadata;

  // Render blocks into lines, respecting available height
  const renderedLines: Array<{ text: string; color?: string; bold?: boolean; dim?: boolean }> = [];
  let blocksShown = 0;

  for (let bi = scrollPos; bi < filteredBlocks.length && renderedLines.length < maxRows; bi++) {
    const block = filteredBlocks[bi];
    const isExpanded = expandedTools.has(bi);
    const isCurrent = bi === scrollPos;

    // Separator between blocks
    if (renderedLines.length > 0) {
      renderedLines.push({ text: "", dim: true });
    }

    if (block.type === "user") {
      renderedLines.push({ text: (isCurrent ? "> " : "  ") + "USER:", color: "green", bold: true });
      for (const line of block.lines.slice(0, 8)) {
        renderedLines.push({ text: "  " + line.slice(0, 120) });
        if (renderedLines.length >= maxRows) break;
      }
      if (block.lines.length > 8) {
        renderedLines.push({ text: `  ... (${block.lines.length - 8} more lines)`, dim: true });
      }
    } else if (block.type === "assistant") {
      renderedLines.push({ text: (isCurrent ? "> " : "  ") + "ASSISTANT:", color: "blue", bold: true });
      const maxLines = 12;
      for (const line of block.lines.slice(0, maxLines)) {
        renderedLines.push({ text: "  " + line.slice(0, 120) });
        if (renderedLines.length >= maxRows) break;
      }
      if (block.lines.length > maxLines) {
        renderedLines.push({ text: `  ... (${block.lines.length - maxLines} more lines)`, dim: true });
      }
    } else if (block.type === "tool-group") {
      const summary = block.lines[0]; // First line is the summary
      renderedLines.push({
        text: (isCurrent ? "> " : "  ") + summary,
        color: "yellow",
        bold: isCurrent,
      });
      if (isExpanded) {
        for (const line of block.lines.slice(1, 20)) {
          renderedLines.push({ text: "    " + line.slice(0, 116), dim: true });
          if (renderedLines.length >= maxRows) break;
        }
        if (block.lines.length > 20) {
          renderedLines.push({ text: `    ... (${block.lines.length - 20} more lines)`, dim: true });
        }
      } else if (block.entryCount > 1) {
        renderedLines.push({ text: `    (${block.entryCount} tool calls, enter to expand)`, dim: true });
      }
    }

    blocksShown++;
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold>Session </Text>
          <Text bold color="cyan">{sessionId.slice(0, 12)}</Text>
          <Text dimColor> | {meta.createdAt?.slice(0, 16)}</Text>
          {meta.agent && <Text dimColor> | {meta.agent}</Text>}
          {meta.model && <Text dimColor> | {meta.model}</Text>}
        </Box>
        {meta.tokenUsage && (
          <Text dimColor>
            Tokens: {meta.tokenUsage.inputTokens.toLocaleString()} in / {meta.tokenUsage.outputTokens.toLocaleString()} out ({meta.tokenUsage.apiCallCount} calls)
          </Text>
        )}
        <Text dimColor>
          {filteredBlocks.length} blocks{searchText ? ` (filtered)` : ""}
          {" | "}{scrollPos + 1}/{filteredBlocks.length}
        </Text>
      </Box>

      {searchActive && (
        <SearchBar label="Search" value={searchText} onChange={setSearchText} />
      )}

      <Box flexDirection="column">
        {renderedLines.map((line, i) => (
          <Text
            key={i}
            color={line.color as any}
            bold={line.bold}
            dimColor={line.dim}
            wrap="truncate"
          >
            {line.text}
          </Text>
        ))}
      </Box>

      <StatusBar
        view="detail"
        searchActive={searchActive}
        info="^/v Scroll  enter Expand tools  / Search  esc Back"
      />
    </Box>
  );
}

/**
 * Build display blocks from raw transcript entries.
 * Groups consecutive tool entries, formats text nicely.
 */
function buildBlocks(entries: SessionEntry[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  let toolGroup: SessionEntry[] = [];

  const flushToolGroup = () => {
    if (toolGroup.length === 0) return;

    const names = toolGroup
      .filter((e) => e.toolName)
      .map((e) => {
        const file = e.filesAffected?.[0]?.split("/").pop() || "";
        return e.toolName + (file ? `(${file})` : "");
      });

    const uniqueNames = [...new Set(names)];
    const summary = `TOOLS: ${uniqueNames.join(", ") || `${toolGroup.length} calls`}`;

    const lines = [summary];
    for (const entry of toolGroup) {
      if (entry.toolName) {
        const file = entry.filesAffected?.[0] || "";
        lines.push(`${entry.toolName} ${file}`);
        // Show a snippet of tool input if it's readable
        if (entry.toolInput && typeof entry.toolInput === "object") {
          const input = entry.toolInput as Record<string, unknown>;
          if (typeof input.command === "string") {
            lines.push(`  $ ${input.command.slice(0, 100)}`);
          } else if (typeof input.pattern === "string") {
            lines.push(`  pattern: ${input.pattern}`);
          } else if (typeof input.content === "string") {
            lines.push(`  (${input.content.length} chars)`);
          }
        }
        // Show snippet of output
        if (typeof entry.toolOutput === "string" && entry.toolOutput.length > 0) {
          const preview = entry.toolOutput.replace(/\n/g, " ").slice(0, 100);
          lines.push(`  -> ${preview}`);
        }
      }
    }

    blocks.push({ type: "tool-group", lines, entryCount: toolGroup.length });
    toolGroup = [];
  };

  for (const entry of entries) {
    if (entry.type === "tool") {
      toolGroup.push(entry);
      continue;
    }

    flushToolGroup();

    if (entry.type === "user") {
      // Skip tool_result-like user entries (they start with tool metadata)
      if (entry.content.startsWith("Tool:") || entry.content.startsWith("{")) continue;
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      blocks.push({ type: "user", lines, entryCount: 1 });
    } else if (entry.type === "assistant") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      blocks.push({ type: "assistant", lines, entryCount: 1 });
    } else if (entry.type === "system") {
      const lines = entry.content.split("\n").filter((l) => l.trim()).slice(0, 3);
      if (lines.length === 0) continue;
      blocks.push({ type: "system", lines, entryCount: 1 });
    }
  }

  flushToolGroup();
  return blocks;
}

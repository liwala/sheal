import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadCodexSession } from "../../entire/codex-native.js";
import type { CodexTranscriptEntry } from "../../entire/codex-native.js";
import { hasRetro } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface CodexSessionDetailProps {
  sessionId: string;
  projectPath: string;
  onBack: () => void;
  onQuit: () => void;
  onViewRetro: () => void;
}

interface DisplayBlock {
  type: "user" | "assistant" | "tool-call" | "tool-output";
  summary: string;
  lines: string[];
  entryCount: number;
}

const PREVIEW_LINES: Record<DisplayBlock["type"], number> = {
  "user": 3,
  "assistant": 4,
  "tool-call": 1,
  "tool-output": 0,
};

const TYPE_COLORS: Record<DisplayBlock["type"], string> = {
  "user": "green",
  "assistant": "blue",
  "tool-call": "yellow",
  "tool-output": "gray",
};

const TYPE_LABELS: Record<DisplayBlock["type"], string> = {
  "user": "USER",
  "assistant": "ASSISTANT",
  "tool-call": "TOOL",
  "tool-output": "OUTPUT",
};

export function CodexSessionDetail({ sessionId, projectPath, onBack, onQuit, onViewRetro }: CodexSessionDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  const { session, blocks, title, hasRetroFile } = useMemo(() => {
    const result = loadCodexSession(sessionId);
    if (!result) return { session: null, blocks: [], title: "", hasRetroFile: false };
    const blks = buildBlocks(result.entries);
    const firstUser = blks.find((b) => b.type === "user");
    const hr = projectPath ? hasRetro(projectPath, sessionId) : false;
    return { session: result, blocks: blks, title: firstUser?.summary || "", hasRetroFile: hr };
  }, [sessionId, projectPath]);

  const filteredBlocks = useMemo(() => {
    if (!searchText) return blocks;
    const q = searchText.toLowerCase();
    return blocks.filter((b) =>
      b.summary.toLowerCase().includes(q) ||
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

    if (input === "q") { onBack(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setSearchActive(true); return; }
    if (input === "r" && hasRetroFile) { onViewRetro(); return; }

    if (key.upArrow) {
      setScrollPos((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setScrollPos((p) => Math.min(Math.max(0, filteredBlocks.length - 1), p + 1));
    } else if (key.pageDown) {
      setScrollPos((p) => Math.min(Math.max(0, filteredBlocks.length - 1), p + Math.floor(maxRows / 3)));
    } else if (key.pageUp) {
      setScrollPos((p) => Math.max(0, p - Math.floor(maxRows / 3)));
    } else if (key.return) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(scrollPos)) next.delete(scrollPos);
        else next.add(scrollPos);
        return next;
      });
    }
  });

  if (!session) {
    return (
      <Box flexDirection="column">
        <Text color="red">Codex session not found: {sessionId}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const meta = session.meta;

  // Render blocks into visible lines
  const renderedLines: Array<{ text: string; color?: string; bold?: boolean; dim?: boolean }> = [];

  for (let bi = scrollPos; bi < filteredBlocks.length && renderedLines.length < maxRows; bi++) {
    const block = filteredBlocks[bi];
    const isExpanded = expanded.has(bi);
    const isCurrent = bi === scrollPos;
    const color = TYPE_COLORS[block.type];
    const label = TYPE_LABELS[block.type];
    const previewCount = PREVIEW_LINES[block.type];

    if (renderedLines.length > 0) {
      renderedLines.push({ text: "" });
    }

    const contentLines = block.lines.slice(1);

    const cursor = isCurrent ? ">" : " ";
    const expandHint = contentLines.length > previewCount
      ? (isExpanded ? " [-]" : ` [+${contentLines.length}]`)
      : "";
    renderedLines.push({
      text: `${cursor} ${label}:${expandHint} ${block.summary.slice(0, 100)}`,
      color,
      bold: isCurrent,
    });

    if (isExpanded) {
      const maxShow = 30;
      for (const line of contentLines.slice(0, maxShow)) {
        renderedLines.push({ text: "    " + line.slice(0, 116), dim: true });
        if (renderedLines.length >= maxRows) break;
      }
      if (contentLines.length > maxShow) {
        renderedLines.push({ text: `    ... (${contentLines.length - maxShow} more lines)`, dim: true });
      }
    } else if (previewCount > 0 && contentLines.length > 0) {
      for (const line of contentLines.slice(0, previewCount)) {
        renderedLines.push({ text: "    " + line.slice(0, 116), dim: true });
        if (renderedLines.length >= maxRows) break;
      }
      if (contentLines.length > previewCount) {
        renderedLines.push({ text: `    ... (${contentLines.length - previewCount} more, enter to expand)`, dim: true });
      }
    }
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold>Codex Session </Text>
          <Text bold color="cyan">{sessionId.slice(0, 12)}</Text>
          <Text dimColor> | {meta.timestamp?.slice(0, 16)}</Text>
          {meta.model && <Text dimColor> | {meta.model}</Text>}
          <Text dimColor> | Codex</Text>
          {hasRetroFile && <Text color="magenta"> [R] retro available (r)</Text>}
        </Box>
        {meta.cwd && <Text dimColor>cwd: {meta.cwd}</Text>}
        {title && <Text>{title}</Text>}
        <Text dimColor>
          {filteredBlocks.length} blocks{searchText ? " (filtered)" : ""}
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
            wrap="wrap"
          >
            {line.text}
          </Text>
        ))}
      </Box>

      <StatusBar
        view="detail"
        searchActive={searchActive}
        info={`^/v Scroll  enter Expand/collapse  / Search${hasRetroFile ? "  r Retro" : ""}  esc Back`}
      />
    </Box>
  );
}

/**
 * Build display blocks from Codex transcript entries.
 */
function buildBlocks(entries: CodexTranscriptEntry[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];

  for (const entry of entries) {
    if (entry.toolName && entry.role === "assistant") {
      // Tool call
      const summary = `${entry.toolName}: ${entry.toolInput || ""}`;
      const lines = [summary];
      if (entry.toolInput) {
        lines.push(entry.toolInput);
      }
      blocks.push({ type: "tool-call", summary: summary.slice(0, 120), lines, entryCount: 1 });
    } else if (entry.toolName && entry.role === "system") {
      // Tool output
      const preview = entry.content.replace(/\n/g, " ").slice(0, 120);
      const lines = entry.content.split("\n").filter((l) => l.trim());
      blocks.push({ type: "tool-output", summary: preview, lines, entryCount: 1 });
    } else if (entry.role === "user") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 120);
      blocks.push({ type: "user", summary, lines, entryCount: 1 });
    } else if (entry.role === "assistant") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 120);
      blocks.push({ type: "assistant", summary, lines, entryCount: 1 });
    }
  }

  return blocks;
}

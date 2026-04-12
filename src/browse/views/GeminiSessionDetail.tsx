import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadGeminiSession } from "../../entire/gemini-native.js";
import type { GeminiTranscriptEntry } from "../../entire/gemini-native.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface DisplayBlock {
  type: "user" | "assistant" | "tool-group";
  summary: string;
  lines: string[];
  entryCount: number;
}

const PREVIEW_LINES: Record<DisplayBlock["type"], number> = {
  "user": 3,
  "assistant": 4,
  "tool-group": 0,
};

const TYPE_COLORS: Record<DisplayBlock["type"], string> = {
  "user": "green",
  "assistant": "blue",
  "tool-group": "yellow",
};

const TYPE_LABELS: Record<DisplayBlock["type"], string> = {
  "user": "USER",
  "assistant": "ASSISTANT",
  "tool-group": "TOOLS",
};

interface GeminiSessionDetailProps {
  sessionId: string;
  projectPath: string;
  onBack: () => void;
  onQuit: () => void;
  onViewRetro: () => void;
}

export function GeminiSessionDetail({ sessionId, projectPath, onBack, onQuit, onViewRetro }: GeminiSessionDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  const { session, blocks, title } = useMemo(() => {
    const s = loadGeminiSession(sessionId);
    if (!s) return { session: null, blocks: [], title: "" };
    const blks = buildGeminiBlocks(s.entries);
    const firstUser = blks.find((b) => b.type === "user");
    return { session: s, blocks: blks, title: firstUser?.summary || "" };
  }, [sessionId]);

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
      if (key.escape) { setSearchActive(false); setSearchText(""); }
      else if (key.return) { setSearchActive(false); }
      return;
    }

    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setSearchActive(true); return; }
    if (input === "r") { onViewRetro(); return; }

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
        <Text color="red">Gemini session not found: {sessionId}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const meta = session.meta;

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
    const callCount = block.type === "tool-group" && block.entryCount > 1
      ? ` (${block.entryCount} calls)` : "";
    const expandHint = contentLines.length > previewCount
      ? (isExpanded ? " [-]" : ` [+${contentLines.length}]`)
      : "";
    renderedLines.push({
      text: `${cursor} ${label}:${callCount}${expandHint} ${block.summary.slice(0, 100)}`,
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
          <Text bold>Session </Text>
          <Text bold color="cyan">{sessionId.slice(0, 12)}</Text>
          <Text dimColor> | {meta.startTime?.slice(0, 16)}</Text>
          <Text color="green"> [Gemini]</Text>
          {meta.model && <Text dimColor> | {meta.model}</Text>}
        </Box>
        {title && <Text>{title}</Text>}
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
            wrap="wrap"
          >
            {line.text}
          </Text>
        ))}
      </Box>

      <StatusBar
        view="detail"
        searchActive={searchActive}
        info={`^/v Scroll  enter Expand/collapse  / Search  esc Back`}
      />
    </Box>
  );
}

function buildGeminiBlocks(entries: GeminiTranscriptEntry[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  let toolGroup: GeminiTranscriptEntry[] = [];

  const flushToolGroup = () => {
    if (toolGroup.length === 0) return;

    const names = toolGroup
      .filter((e) => e.toolName)
      .map((e) => e.toolName!);
    const uniqueNames = [...new Set(names)];
    const summary = uniqueNames.join(", ") || `${toolGroup.length} calls`;

    const lines: string[] = [];
    for (const entry of toolGroup) {
      if (entry.toolName) {
        lines.push(entry.toolName);
        if (entry.toolInput) lines.push(`  ${entry.toolInput.slice(0, 100)}`);
        if (entry.toolOutput) lines.push(`  -> ${entry.toolOutput.replace(/\n/g, " ").slice(0, 100)}`);
      }
    }

    blocks.push({ type: "tool-group", summary, lines, entryCount: toolGroup.length });
    toolGroup = [];
  };

  for (const entry of entries) {
    if (entry.role === "tool") {
      toolGroup.push(entry);
      continue;
    }

    flushToolGroup();

    if (entry.role === "user") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      blocks.push({ type: "user", summary: lines[0].slice(0, 120), lines, entryCount: 1 });
    } else if (entry.role === "assistant") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      blocks.push({ type: "assistant", summary: lines[0].slice(0, 120), lines, entryCount: 1 });
    }
  }

  flushToolGroup();
  return blocks;
}

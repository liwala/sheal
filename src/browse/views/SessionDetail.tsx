import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadNativeSessionBySlug } from "../../entire/claude-native.js";
import { hasRetro } from "../utils/retro-status.js";
import { buildBlocks, PREVIEW_LINES, TYPE_COLORS, TYPE_LABELS } from "../utils/blocks.js";
import type { DisplayBlock } from "../utils/blocks.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface SessionDetailProps {
  slug: string;
  sessionId: string;
  projectPath: string;
  onBack: () => void;
  onQuit: () => void;
  onViewRetro: () => void;
}

interface RenderedLine {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  blockIndex?: number; // which block this line belongs to (for enter to toggle)
}

export function SessionDetail({ slug, sessionId, projectPath, onBack, onQuit, onViewRetro }: SessionDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { stdout } = useStdout();
  // Reserve: 4 header lines + 1 margin + 2 status bar lines + 1 buffer
  const termRows = stdout?.rows ?? 24;
  const maxRows = Math.max(3, termRows - 8);

  const { checkpoint, blocks, title, hasRetroFile } = useMemo(() => {
    const cp = loadNativeSessionBySlug(slug, sessionId);
    if (!cp || cp.sessions.length === 0) return { checkpoint: null, blocks: [], title: "", hasRetroFile: false };
    const blks = buildBlocks(cp.sessions[0].transcript);
    const firstUser = blks.find((b) => b.type === "user");
    const hr = projectPath ? hasRetro(projectPath, sessionId) : false;
    return { checkpoint: cp, blocks: blks, title: firstUser?.summary || "", hasRetroFile: hr };
  }, [slug, sessionId, projectPath]);

  const filteredBlocks = useMemo(() => {
    if (!searchText) return blocks;
    const q = searchText.toLowerCase();
    return blocks.filter((b) =>
      b.summary.toLowerCase().includes(q) ||
      b.lines.some((l) => l.toLowerCase().includes(q)),
    );
  }, [blocks, searchText]);

  // Flatten all blocks into lines for line-level scrolling
  const { allLines, blockStarts } = useMemo(() => {
    const lines: RenderedLine[] = [];
    const starts: number[] = [];

    for (let bi = 0; bi < filteredBlocks.length; bi++) {
      const block = filteredBlocks[bi];
      const isExpanded = expanded.has(bi);
      const isSelected = bi === selectedBlock;
      const color = TYPE_COLORS[block.type];
      const label = TYPE_LABELS[block.type];
      const previewCount = PREVIEW_LINES[block.type];
      const contentLines = block.lines.slice(1);
      const cursor = isSelected ? ">" : " ";

      if (lines.length > 0) {
        lines.push({ text: "" });
      }

      starts.push(lines.length);

      const callCount = block.type === "tool-group" && block.entryCount > 1
        ? ` (${block.entryCount} calls)` : "";

      if (isExpanded) {
        lines.push({
          text: `${cursor} ${label}:${callCount} [-]`,
          color,
          bold: isSelected,
          blockIndex: bi,
        });
        for (const line of block.lines) {
          lines.push({ text: "    " + line, dim: true, blockIndex: bi });
        }
      } else {
        const expandHint = contentLines.length > previewCount
          ? ` [+${contentLines.length}]`
          : "";
        lines.push({
          text: `${cursor} ${label}:${callCount}${expandHint} ${block.summary.slice(0, 100)}`,
          color,
          bold: isSelected,
          blockIndex: bi,
        });
        if (previewCount > 0 && contentLines.length > 0) {
          for (const line of contentLines.slice(0, previewCount)) {
            lines.push({ text: "    " + line.slice(0, 116), dim: true, blockIndex: bi });
          }
          if (contentLines.length > previewCount) {
            lines.push({ text: `    ... (${contentLines.length - previewCount} more, enter to expand)`, dim: true, blockIndex: bi });
          }
        }
      }
    }
    return { allLines: lines, blockStarts: starts };
  }, [filteredBlocks, expanded, selectedBlock]);

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
    if (input === "r") { onViewRetro(); return; }

    const totalLines = allLines.length;
    const cap = (v: number) => Math.max(0, Math.min(Math.max(0, totalLines - maxRows), v));
    const blockCount = filteredBlocks.length;

    if (key.upArrow) {
      setScrollPos((p) => cap(p - 3));
    } else if (key.downArrow) {
      setScrollPos((p) => cap(p + 3));
    } else if (key.pageDown) {
      setScrollPos((p) => cap(p + maxRows));
    } else if (key.pageUp) {
      setScrollPos((p) => cap(p - maxRows));
    } else if (input === "n" || key.tab) {
      // Move cursor to next block and scroll to show it
      setSelectedBlock((b) => {
        const next = Math.min(blockCount - 1, b + 1);
        const lineIdx = blockStarts[next];
        if (lineIdx !== undefined) setScrollPos(cap(lineIdx));
        return next;
      });
    } else if (input === "p") {
      // Move cursor to previous block and scroll to show it
      setSelectedBlock((b) => {
        const prev = Math.max(0, b - 1);
        const lineIdx = blockStarts[prev];
        if (lineIdx !== undefined) setScrollPos(cap(lineIdx));
        return prev;
      });
    } else if (key.return) {
      // Toggle the block at the cursor
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(selectedBlock)) next.delete(selectedBlock);
        else next.add(selectedBlock);
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

  const visibleLines = allLines.slice(scrollPos, scrollPos + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold>Session </Text>
          <Text bold color="cyan">{sessionId.slice(0, 12)}</Text>
          <Text dimColor> | {meta.createdAt?.slice(0, 16)}</Text>
          {meta.agent && <Text dimColor> | {meta.agent}</Text>}
          {meta.model && <Text dimColor> | {meta.model}</Text>}
          {hasRetroFile && <Text color="magenta"> [R] retro available (r)</Text>}
        </Box>
        {title && <Text>{title}</Text>}
        {meta.tokenUsage && (
          <Text dimColor>
            Tokens: {meta.tokenUsage.inputTokens.toLocaleString()} in / {meta.tokenUsage.outputTokens.toLocaleString()} out ({meta.tokenUsage.apiCallCount} calls)
          </Text>
        )}
        <Text dimColor>
          {filteredBlocks.length} blocks{searchText ? ` (filtered)` : ""}
          {" | "}line {scrollPos + 1}/{allLines.length}
        </Text>
      </Box>

      {searchActive && (
        <SearchBar label="Search" value={searchText} onChange={setSearchText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {visibleLines.map((line, i) => (
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
        info={`^/v Scroll  n/p Next/prev block  enter Expand  / Search${hasRetroFile ? "  r Retro" : ""}  esc Back`}
      />
    </Box>
  );
}


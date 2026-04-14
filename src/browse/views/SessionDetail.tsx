import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadNativeSessionBySlug } from "../../entire/claude-native.js";
import { hasRetro } from "../utils/retro-status.js";
import { buildBlocks, PREVIEW_LINES, TYPE_COLORS, TYPE_LABELS } from "../utils/blocks.js";
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
}

export function SessionDetail({ slug, sessionId, projectPath, onBack, onQuit, onViewRetro }: SessionDetailProps) {
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [innerMode, setInnerMode] = useState(false);   // inside an expanded block
  const [innerScroll, setInnerScroll] = useState(0);    // scroll offset within expanded block
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

  // Build visible lines based on mode
  const visibleOutput = useMemo(() => {
    if (innerMode && expanded.has(selectedBlock) && filteredBlocks[selectedBlock]) {
      // Inner mode: show the expanded block's full content with scroll
      const block = filteredBlocks[selectedBlock];
      const color = TYPE_COLORS[block.type];
      const label = TYPE_LABELS[block.type];
      const callCount = block.type === "tool-group" && block.entryCount > 1
        ? ` (${block.entryCount} calls)` : "";

      const lines: RenderedLine[] = [];
      lines.push({ text: `> ${label}:${callCount} [-] (esc to exit)`, color, bold: true });
      for (const line of block.lines) {
        lines.push({ text: "  " + line, dim: false });
      }

      const totalLines = lines.length;
      const cappedScroll = Math.max(0, Math.min(innerScroll, totalLines - maxRows));
      return { lines: lines.slice(cappedScroll, cappedScroll + maxRows), totalLines, scrollPos: cappedScroll };
    }

    // Block mode: show one header line per block, centered on selectedBlock
    const lines: RenderedLine[] = [];
    for (let bi = 0; bi < filteredBlocks.length; bi++) {
      const block = filteredBlocks[bi];
      const isExpanded = expanded.has(bi);
      const isSelected = bi === selectedBlock;
      const color = TYPE_COLORS[block.type];
      const label = TYPE_LABELS[block.type];
      const previewCount = PREVIEW_LINES[block.type];
      const contentLines = block.lines.slice(1);
      const cursor = isSelected ? ">" : " ";
      const callCount = block.type === "tool-group" && block.entryCount > 1
        ? ` (${block.entryCount} calls)` : "";

      if (lines.length > 0) lines.push({ text: "" });

      if (isExpanded) {
        lines.push({ text: `${cursor} ${label}:${callCount} [-]`, color, bold: isSelected });
        for (const line of block.lines) {
          lines.push({ text: "    " + line, dim: true });
        }
      } else {
        const expandHint = contentLines.length > previewCount
          ? ` [+${contentLines.length}]` : "";
        lines.push({
          text: `${cursor} ${label}:${callCount}${expandHint} ${block.summary.slice(0, 100)}`,
          color, bold: isSelected,
        });
        if (previewCount > 0 && contentLines.length > 0) {
          for (const line of contentLines.slice(0, previewCount)) {
            lines.push({ text: "    " + line.slice(0, 116), dim: true });
          }
          if (contentLines.length > previewCount) {
            lines.push({ text: `    ... (${contentLines.length - previewCount} more, enter to expand)`, dim: true });
          }
        }
      }
    }

    // Find the line index of the selected block header and center viewport
    let selectedLineIdx = 0;
    let lineCount = 0;
    for (let bi = 0; bi < filteredBlocks.length; bi++) {
      if (bi === selectedBlock) { selectedLineIdx = lineCount; break; }
      if (lineCount > 0) lineCount++; // blank separator
      lineCount++; // header line
      const block = filteredBlocks[bi];
      if (expanded.has(bi)) {
        lineCount += block.lines.length;
      } else {
        const previewCount = PREVIEW_LINES[block.type];
        const contentLines = block.lines.slice(1);
        const shown = Math.min(contentLines.length, previewCount);
        lineCount += shown;
        if (contentLines.length > previewCount) lineCount++; // "... more" line
      }
    }

    const scrollStart = Math.max(0, Math.min(selectedLineIdx - 2, lines.length - maxRows));
    return { lines: lines.slice(scrollStart, scrollStart + maxRows), totalLines: lines.length, scrollPos: scrollStart };
  }, [filteredBlocks, expanded, selectedBlock, innerMode, innerScroll, maxRows]);

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

    // Inner mode: scrolling within an expanded block
    if (innerMode) {
      if (key.escape || input === "q") {
        setInnerMode(false);
        setInnerScroll(0);
        return;
      }
      if (key.upArrow) {
        setInnerScroll((s) => Math.max(0, s - 1));
      } else if (key.downArrow) {
        setInnerScroll((s) => s + 1);
      } else if (key.pageDown) {
        setInnerScroll((s) => s + maxRows);
      } else if (key.pageUp) {
        setInnerScroll((s) => Math.max(0, s - maxRows));
      }
      return;
    }

    // Block mode
    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setSearchActive(true); return; }
    if (input === "r") { onViewRetro(); return; }

    const blockCount = filteredBlocks.length;

    if (key.upArrow) {
      setSelectedBlock((b) => Math.max(0, b - 1));
    } else if (key.downArrow) {
      setSelectedBlock((b) => Math.min(blockCount - 1, b + 1));
    } else if (key.pageDown) {
      setSelectedBlock((b) => Math.min(blockCount - 1, b + 5));
    } else if (key.pageUp) {
      setSelectedBlock((b) => Math.max(0, b - 5));
    } else if (key.return) {
      // Toggle expand; if expanding, enter inner mode
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(selectedBlock)) {
          next.delete(selectedBlock);
          setInnerMode(false);
        } else {
          next.add(selectedBlock);
          setInnerScroll(0);
          setInnerMode(true);
        }
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

  const modeLabel = innerMode ? "READING" : "BLOCKS";
  const blockPos = `block ${selectedBlock + 1}/${filteredBlocks.length}`;
  const lineInfo = innerMode
    ? `line ${visibleOutput.scrollPos + 1}/${visibleOutput.totalLines}`
    : blockPos;

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
          [{modeLabel}] {lineInfo}{searchText ? ` (filtered)` : ""}
        </Text>
      </Box>

      {searchActive && (
        <SearchBar label="Search" value={searchText} onChange={setSearchText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {visibleOutput.lines.map((line, i) => (
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
        info={innerMode
          ? `^/v Scroll  pgup/pgdn Page  esc Exit block`
          : `^/v Move  enter Expand+read  / Search${hasRetroFile ? "  r Retro" : ""}  esc Back`}
      />
    </Box>
  );
}


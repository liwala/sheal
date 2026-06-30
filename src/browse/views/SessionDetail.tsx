import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadNativeSessionBySlug } from "@liwala/agent-sessions";
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

export function SessionDetail({ slug, sessionId, projectPath, onBack, onQuit, onViewRetro }: SessionDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

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

    if (key.upArrow) {
      setScrollPos((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setScrollPos((p) => Math.min(Math.max(0, filteredBlocks.length - 1), p + 1));
    } else if (key.pageDown) {
      setScrollPos((p) => Math.min(Math.max(0, filteredBlocks.length - 1), p + Math.floor(maxRows / 3)));
    } else if (key.pageUp) {
      setScrollPos((p) => Math.max(0, p - Math.floor(maxRows / 3)));
    } else if (key.return) {
      // Toggle block expansion
      setExpanded((prev) => {
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

  // Render blocks into visible lines
  const renderedLines: Array<{ text: string; color?: string; bold?: boolean; dim?: boolean }> = [];

  for (let bi = scrollPos; bi < filteredBlocks.length && renderedLines.length < maxRows; bi++) {
    const block = filteredBlocks[bi];
    const isExpanded = expanded.has(bi);
    const isCurrent = bi === scrollPos;
    const color = TYPE_COLORS[block.type];
    const label = TYPE_LABELS[block.type];
    const previewCount = PREVIEW_LINES[block.type];

    // Separator between blocks
    if (renderedLines.length > 0) {
      renderedLines.push({ text: "" });
    }

    // Content lines (skip first line since it's already in the summary)
    const contentLines = block.lines.slice(1);

    // Header line: "> ASSISTANT: [+N] first line..."
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


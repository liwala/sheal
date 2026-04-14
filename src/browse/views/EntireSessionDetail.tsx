import { Box, Text, useInput, useStdout } from "ink";
import { useState, useEffect } from "react";
import { loadCheckpoint } from "../../entire/reader.js";
import type { Checkpoint } from "../../entire/types.js";
import { hasRetro } from "../utils/retro-status.js";
import { buildBlocks, PREVIEW_LINES, TYPE_COLORS, TYPE_LABELS } from "../utils/blocks.js";
import type { DisplayBlock } from "../utils/blocks.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface EntireSessionDetailProps {
  checkpointId: string;
  projectPath: string;
  onBack: () => void;
  onQuit: () => void;
  onViewRetro: () => void;
}

export function EntireSessionDetail({ checkpointId, projectPath, onBack, onQuit, onViewRetro }: EntireSessionDetailProps) {
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCheckpoint(projectPath, checkpointId).then((cp) => {
      if (!cancelled) {
        setCheckpoint(cp);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [projectPath, checkpointId]);

  const blocks = checkpoint && checkpoint.sessions.length > 0
    ? buildBlocks(checkpoint.sessions[0].transcript)
    : [];

  const title = blocks.find((b) => b.type === "user")?.summary || "";
  const hasRetroFile = projectPath ? hasRetro(projectPath, checkpointId) : false;

  const filteredBlocks = searchText
    ? blocks.filter((b) =>
        b.summary.toLowerCase().includes(searchText.toLowerCase()) ||
        b.lines.some((l) => l.toLowerCase().includes(searchText.toLowerCase())),
      )
    : blocks;

  useInput((input, key) => {
    if (searchActive) {
      if (key.escape) { setSearchActive(false); setSearchText(""); }
      else if (key.return) { setSearchActive(false); }
      return;
    }

    if (input === "q") { onBack(); return; }
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

  if (loading) {
    return (
      <Box flexDirection="column">
        <Text>Loading checkpoint {checkpointId.slice(0, 12)}...</Text>
      </Box>
    );
  }

  if (!checkpoint || checkpoint.sessions.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">Checkpoint not found: {checkpointId}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const session = checkpoint.sessions[0];
  const meta = session.metadata;

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
          <Text bold>Checkpoint </Text>
          <Text bold color="cyan">{checkpointId.slice(0, 12)}</Text>
          <Text dimColor> | {meta.createdAt?.slice(0, 16)}</Text>
          {meta.agent && <Text dimColor> | {meta.agent}</Text>}
          {meta.model && <Text dimColor> | {meta.model}</Text>}
          <Text color="yellow"> [Entire.io]</Text>
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
          {checkpoint.sessions.length > 1 && ` | ${checkpoint.sessions.length} sessions in checkpoint`}
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

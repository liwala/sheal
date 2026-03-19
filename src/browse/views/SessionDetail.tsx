import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadNativeSessionBySlug } from "../../entire/claude-native.js";
import type { SessionEntry } from "../../entire/types.js";
import { hasRetro } from "../utils/retro-status.js";
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

/** Collapse transcript into readable "blocks" — group consecutive tool entries, etc. */
interface DisplayBlock {
  type: "user" | "assistant" | "tool-group" | "system";
  /** One-line summary shown when collapsed */
  summary: string;
  /** Full content lines (shown when expanded) */
  lines: string[];
  /** Number of raw entries this block represents */
  entryCount: number;
}

/** Default collapsed preview lines per block type */
const PREVIEW_LINES: Record<DisplayBlock["type"], number> = {
  "user": 3,
  "assistant": 4,
  "tool-group": 0,
  "system": 1,
};

const TYPE_COLORS: Record<DisplayBlock["type"], string> = {
  "user": "green",
  "assistant": "blue",
  "tool-group": "yellow",
  "system": "gray",
};

const TYPE_LABELS: Record<DisplayBlock["type"], string> = {
  "user": "USER",
  "assistant": "ASSISTANT",
  "tool-group": "TOOLS",
  "system": "SYSTEM",
};

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

    // Header line: "> ASSISTANT: first line of summary..."
    const cursor = isCurrent ? ">" : " ";
    const expandHint = block.lines.length > previewCount
      ? (isExpanded ? " [-]" : ` [+${block.lines.length}]`)
      : "";
    renderedLines.push({
      text: `${cursor} ${label}:${expandHint} ${block.summary.slice(0, 100)}`,
      color,
      bold: isCurrent,
    });

    // Content lines
    if (isExpanded) {
      // Show all lines (up to 30)
      const maxShow = 30;
      for (const line of block.lines.slice(0, maxShow)) {
        renderedLines.push({ text: "    " + line.slice(0, 116), dim: true });
        if (renderedLines.length >= maxRows) break;
      }
      if (block.lines.length > maxShow) {
        renderedLines.push({ text: `    ... (${block.lines.length - maxShow} more lines)`, dim: true });
      }
    } else if (previewCount > 0 && block.lines.length > 0) {
      // Show a few preview lines
      for (const line of block.lines.slice(0, previewCount)) {
        renderedLines.push({ text: "    " + line.slice(0, 116), dim: true });
        if (renderedLines.length >= maxRows) break;
      }
      if (block.lines.length > previewCount) {
        renderedLines.push({ text: `    ... (${block.lines.length - previewCount} more, enter to expand)`, dim: true });
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
            wrap="truncate"
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
    const summary = uniqueNames.join(", ") || `${toolGroup.length} calls`;

    const lines: string[] = [];
    for (const entry of toolGroup) {
      if (entry.toolName) {
        const file = entry.filesAffected?.[0] || "";
        lines.push(`${entry.toolName} ${file}`);
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
        if (typeof entry.toolOutput === "string" && entry.toolOutput.length > 0) {
          const preview = entry.toolOutput.replace(/\n/g, " ").slice(0, 100);
          lines.push(`  -> ${preview}`);
        }
      }
    }

    blocks.push({ type: "tool-group", summary, lines, entryCount: toolGroup.length });
    toolGroup = [];
  };

  for (const entry of entries) {
    if (entry.type === "tool") {
      toolGroup.push(entry);
      continue;
    }

    flushToolGroup();

    if (entry.type === "user") {
      // Skip tool_result-like user entries
      if (entry.content.startsWith("Tool:") || entry.content.startsWith("{")) continue;
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 120);
      blocks.push({ type: "user", summary, lines, entryCount: 1 });
    } else if (entry.type === "assistant") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 120);
      blocks.push({ type: "assistant", summary, lines, entryCount: 1 });
    } else if (entry.type === "system") {
      const lines = entry.content.split("\n").filter((l) => l.trim()).slice(0, 3);
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 80);
      blocks.push({ type: "system", summary, lines, entryCount: 1 });
    }
  }

  flushToolGroup();
  return blocks;
}

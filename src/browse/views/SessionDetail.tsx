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

export function SessionDetail({ slug, sessionId, onBack, onQuit }: SessionDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const { checkpoint, entries } = useMemo(() => {
    const cp = loadNativeSessionBySlug(slug, sessionId);
    if (!cp || cp.sessions.length === 0) return { checkpoint: null, entries: [] };
    return { checkpoint: cp, entries: cp.sessions[0].transcript };
  }, [slug, sessionId]);

  const filteredEntries = useMemo(() => {
    if (!searchText) return entries;
    const q = searchText.toLowerCase();
    return entries.filter((e) => e.content.toLowerCase().includes(q));
  }, [entries, searchText]);

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
      setScrollPos((p) => Math.min(filteredEntries.length - 1, p + 1));
    } else if (key.pageDown) {
      setScrollPos((p) => Math.min(filteredEntries.length - 1, p + maxRows));
    } else if (key.pageUp) {
      setScrollPos((p) => Math.max(0, p - maxRows));
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
  const visible = filteredEntries.slice(scrollPos, scrollPos + maxRows);

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
            Tokens: {meta.tokenUsage.inputTokens} in / {meta.tokenUsage.outputTokens} out ({meta.tokenUsage.apiCallCount} calls)
          </Text>
        )}
        <Text dimColor>
          {filteredEntries.length} entries{searchText ? ` (filtered from ${entries.length})` : ""}
          {" "}| Showing {scrollPos + 1}-{Math.min(scrollPos + maxRows, filteredEntries.length)}
        </Text>
      </Box>

      {searchActive && (
        <SearchBar label="Search" value={searchText} onChange={setSearchText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {visible.map((entry, i) => (
          <EntryRow key={`${scrollPos + i}`} entry={entry} highlight={searchText} />
        ))}
      </Box>

      <StatusBar view="detail" searchActive={searchActive} />
    </Box>
  );
}

function EntryRow({ entry, highlight }: { entry: SessionEntry; highlight: string }) {
  const typeColor = entry.type === "user" ? "green"
    : entry.type === "assistant" ? "blue"
    : entry.type === "tool" ? "yellow"
    : "gray";

  const label = entry.type === "tool" && entry.toolName
    ? `TOOL:${entry.toolName}`
    : entry.type.toUpperCase();

  // Truncate content to one line
  const maxLen = 120;
  let content = entry.content.replace(/\n/g, " ").slice(0, maxLen);
  if (entry.content.length > maxLen) content += "...";

  return (
    <Box>
      <Text color={typeColor} bold>{label.padEnd(15)}</Text>
      <Text wrap="truncate">{content}</Text>
    </Box>
  );
}

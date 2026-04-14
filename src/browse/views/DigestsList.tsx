import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { listDigests } from "../../commands/digest.js";
import type { DigestInfo } from "../../commands/digest.js";
import { StatusBar } from "../components/StatusBar.js";

interface DigestsListProps {
  onSelect: (filename: string) => void;
  onBack: () => void;
  onQuit: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function DigestsList({ onSelect, onBack, onQuit }: DigestsListProps) {
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const digests = useMemo(() => listDigests(), []);

  useInput((input, key) => {
    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }

    if (key.upArrow) {
      setCursor((c) => {
        const next = Math.max(0, c - 1);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
    } else if (key.downArrow) {
      setCursor((c) => {
        const next = Math.min(digests.length - 1, c + 1);
        if (next >= scrollOffset + maxRows) setScrollOffset(next - maxRows + 1);
        return next;
      });
    } else if (key.return && digests[cursor]) {
      onSelect(digests[cursor].filename);
    }
  });

  if (digests.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Digests</Text>
        <Text color="yellow">No digest reports found.</Text>
        <Text dimColor>Run: sheal digest --since "7 days"</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const windowItems = digests.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Digests</Text>
        <Text dimColor> ({digests.length})</Text>
      </Box>

      <Box flexDirection="column" height={maxRows}>
        {windowItems.map((d, i) => {
          const globalIdx = scrollOffset + i;
          return (
            <Box key={d.filename}>
              <Text color={globalIdx === cursor ? "cyan" : undefined} bold={globalIdx === cursor}>
                {globalIdx === cursor ? "> " : "  "}
                {d.date}
              </Text>
              <Text dimColor> [{d.scope}]</Text>
              <Text> {d.totalSessions}s {d.totalPrompts}p</Text>
              <Text color="yellow"> {formatTokens(d.tokenTotal)}tok</Text>
              <Text dimColor> {d.categoryBreakdown}</Text>
            </Box>
          );
        })}
        {digests.length > maxRows && scrollOffset + maxRows < digests.length && (
          <Text dimColor>  ↓ {digests.length - scrollOffset - maxRows} more</Text>
        )}
      </Box>

      <StatusBar
        view="detail"
        searchActive={false}
        info="^/v Navigate  enter View digest  esc Back"
      />
    </Box>
  );
}

import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { join } from "node:path";
import { listAsks } from "../utils/retro-status.js";
import type { AskInfo } from "../utils/retro-status.js";
import { StatusBar } from "../components/StatusBar.js";

interface AsksListProps {
  projectPath: string;
  projectName: string;
  onSelect: (filename: string) => void;
  onBack: () => void;
  onQuit: () => void;
}

export function AsksList({ projectPath, projectName, onSelect, onBack, onQuit }: AsksListProps) {
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const asks = useMemo(() => {
    const dir = join(projectPath, ".sheal", "asks");
    return listAsks(dir);
  }, [projectPath]);

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
        const next = Math.min(asks.length - 1, c + 1);
        if (next >= scrollOffset + maxRows) setScrollOffset(next - maxRows + 1);
        return next;
      });
    } else if (key.return && asks[cursor]) {
      onSelect(asks[cursor].filename);
    }
  });

  if (asks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{projectName}</Text>
        <Text color="yellow">No ask results found.</Text>
        <Text dimColor>Run: sheal ask "your question"</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const windowItems = asks.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{projectName}</Text>
        <Text bold color="blueBright">{" > Asks"}</Text>
        <Text dimColor> ({asks.length})</Text>
      </Box>

      <Box flexDirection="column" height={maxRows}>
        {windowItems.map((a, i) => {
          const globalIdx = scrollOffset + i;
          return (
            <Box key={a.filename}>
              <Text color={globalIdx === cursor ? "blueBright" : undefined} bold={globalIdx === cursor}>
                {globalIdx === cursor ? "> " : "  "}
                {a.date}
              </Text>
              <Text dimColor> ({a.sessionCount}s)</Text>
              <Text> {a.question.slice(0, 60)}</Text>
            </Box>
          );
        })}
        {asks.length > maxRows && scrollOffset + maxRows < asks.length && (
          <Text dimColor>  ↓ {asks.length - scrollOffset - maxRows} more</Text>
        )}
      </Box>

      <StatusBar
        view="detail"
        searchActive={false}
        info="^/v Navigate  enter View answer  esc Back"
      />
    </Box>
  );
}

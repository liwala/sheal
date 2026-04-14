import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { listRetros } from "../utils/retro-status.js";
import type { RetroInfo } from "../utils/retro-status.js";
import { StatusBar } from "../components/StatusBar.js";

interface RetroListProps {
  projectPath: string;
  projectName: string;
  onSelect: (sessionId: string) => void;
  onBack: () => void;
  onQuit: () => void;
}

export function RetroList({ projectPath, projectName, onSelect, onBack, onQuit }: RetroListProps) {
  const [cursor, setCursor] = useState(0);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const retros = useMemo(() => listRetros(projectPath), [projectPath]);

  useInput((input, key) => {
    if (input === "q") { onBack(); return; }
    if (key.escape) { onBack(); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(retros.length - 1, c + 1));
    } else if (key.return && retros[cursor]) {
      onSelect(retros[cursor].sessionId);
    }
  });

  if (retros.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{projectName}</Text>
        <Text color="yellow">No retrospectives found.</Text>
        <Text dimColor>Run: sheal retro --enrich</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{projectName}</Text>
        <Text bold color="magenta">{" > Retros"}</Text>
        <Text dimColor> ({retros.length})</Text>
      </Box>

      <Box flexDirection="column" height={maxRows}>
        {retros.slice(0, maxRows).map((r, i) => (
          <Box key={r.sessionId}>
            <Text color={i === cursor ? "magenta" : undefined} bold={i === cursor}>
              {i === cursor ? "> " : "  "}
              {r.sessionId.slice(0, 12)}
            </Text>
            <Text> {r.preview.slice(0, 80)}</Text>
          </Box>
        ))}
      </Box>

      <StatusBar
        view="detail"
        searchActive={false}
        info="^/v Navigate  enter View retro  esc Back"
      />
    </Box>
  );
}

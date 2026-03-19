import { Box, Text } from "ink";
import type { View } from "../types.js";

interface StatusBarProps {
  view: View;
  searchActive: boolean;
  info?: string;
}

export function StatusBar({ view, searchActive, info }: StatusBarProps) {
  if (searchActive) {
    return (
      <Box>
        <Text dimColor>esc Cancel  enter Confirm</Text>
      </Box>
    );
  }

  const keys: string[] = [];

  if (view === "projects" || view === "sessions" || view === "search-results") {
    keys.push("^/v Navigate", "enter Select", "/ Filter", "a Agent filter", "s Search transcripts");
  }

  if (view === "sessions") {
    keys.push("r Retros", "l Learnings");
  }

  if (view === "detail") {
    keys.push("^/v Scroll", "/ Search in transcript");
  }

  if (view !== "projects") {
    keys.push("esc Back");
  }

  keys.push("q Quit");

  return (
    <Box flexDirection="column">
      {info && <Text dimColor>{info}</Text>}
      <Text dimColor>{keys.join("  ")}</Text>
    </Box>
  );
}

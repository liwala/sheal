import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadRetroContent } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface RetroDetailProps {
  projectPath: string;
  sessionId: string;
  onBack: () => void;
  onQuit: () => void;
}

export function RetroDetail({ projectPath, sessionId, onBack, onQuit }: RetroDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const { lines, sections } = useMemo(() => {
    const content = loadRetroContent(projectPath, sessionId);
    if (!content) return { lines: [], sections: [] };
    const allLines = content.split("\n");
    const secs: Array<{ label: string; lineIdx: number }> = [];
    allLines.forEach((l, i) => {
      if (l.startsWith("**") && l.endsWith("**")) {
        secs.push({ label: l.replace(/\*\*/g, ""), lineIdx: i });
      }
    });
    return { lines: allLines, sections: secs };
  }, [projectPath, sessionId]);

  const filteredLines = useMemo(() => {
    if (!searchText) return lines;
    const q = searchText.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, searchText]);

  useInput((input, key) => {
    if (searchActive) {
      if (key.escape) { setSearchActive(false); setSearchText(""); }
      else if (key.return) { setSearchActive(false); }
      return;
    }

    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setSearchActive(true); return; }

    if (key.upArrow) {
      setScrollPos((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setScrollPos((p) => Math.min(Math.max(0, filteredLines.length - maxRows), p + 1));
    } else if (key.pageDown) {
      setScrollPos((p) => Math.min(Math.max(0, filteredLines.length - maxRows), p + maxRows));
    } else if (key.pageUp) {
      setScrollPos((p) => Math.max(0, p - maxRows));
    }
  });

  if (lines.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No retrospective found for session {sessionId.slice(0, 12)}</Text>
        <Text dimColor>Run: sheal retro -c {sessionId} --enrich</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const visibleLines = filteredLines.slice(scrollPos, scrollPos + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="magenta">Retro</Text>
        <Text bold>{" "}{sessionId.slice(0, 12)}</Text>
        <Text dimColor> | {filteredLines.length} lines</Text>
        <Text dimColor> | {scrollPos + 1}-{Math.min(scrollPos + maxRows, filteredLines.length)}/{filteredLines.length}</Text>
      </Box>

      {searchActive && (
        <SearchBar label="Search" value={searchText} onChange={setSearchText} />
      )}

      <Box flexDirection="column">
        {visibleLines.map((line, i) => {
          const isBold = line.startsWith("**");
          const isBullet = line.trimStart().startsWith("- ");
          const isRule = line.trimStart().startsWith("- When ") || line.trimStart().startsWith("- Before ") || line.trimStart().startsWith("- After ");
          return (
            <Text
              key={scrollPos + i}
              bold={isBold}
              color={isBold ? "magenta" : isRule ? "green" : isBullet ? "yellow" : undefined}
              wrap="truncate"
            >
              {line || " "}
            </Text>
          );
        })}
      </Box>

      <StatusBar
        view="detail"
        searchActive={searchActive}
        info="^/v Scroll  PgUp/PgDn  / Search  esc Back"
      />
    </Box>
  );
}

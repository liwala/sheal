import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { join } from "node:path";
import { loadAskContent } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface AskDetailProps {
  projectPath: string;
  filename: string;
  onBack: () => void;
  onQuit: () => void;
}

export function AskDetail({ projectPath, filename, onBack, onQuit }: AskDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const { lines, question } = useMemo(() => {
    const dir = join(projectPath, ".sheal", "asks");
    const content = loadAskContent(dir, filename);
    if (!content) return { lines: [], question: "" };

    // Extract question from frontmatter
    const qMatch = content.match(/^question:\s*(.+)/m);
    const q = qMatch ? qMatch[1].trim() : "";

    // Get body after frontmatter
    const bodyStart = content.indexOf("\n---", 4);
    const body = bodyStart >= 0 ? content.slice(bodyStart + 4).trim() : content;

    return { lines: body.split("\n"), question: q };
  }, [projectPath, filename]);

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

    if (input === "q") { onBack(); return; }
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
        <Text color="yellow">Ask result not found: {filename}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const visibleLines = filteredLines.slice(scrollPos, scrollPos + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="blueBright">Ask</Text>
          <Text bold>{" "}{question.slice(0, 80)}</Text>
        </Box>
        <Text dimColor>
          {filteredLines.length} lines | {scrollPos + 1}-{Math.min(scrollPos + maxRows, filteredLines.length)}/{filteredLines.length}
        </Text>
      </Box>

      {searchActive && (
        <SearchBar label="Search" value={searchText} onChange={setSearchText} />
      )}

      <Box flexDirection="column">
        {visibleLines.map((line, i) => {
          const isHeading = line.startsWith("##");
          const isBullet = line.trimStart().startsWith("- ");
          const isSessionRef = line.trimStart().startsWith("- ") && line.includes("hits)");
          return (
            <Text
              key={scrollPos + i}
              bold={isHeading}
              color={isHeading ? "blueBright" : isSessionRef ? "gray" : isBullet ? "yellow" : undefined}
              wrap="wrap"
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

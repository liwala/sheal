import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRetroContent } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface RetroDetailProps {
  projectPath: string;
  sessionId: string;
  onBack: () => void;
  onQuit: () => void;
}

interface EnrichmentTab {
  label: string;
  lines: string[];
}

/**
 * Load all enrichments for a session: per-agent files ({id}.{agent}.md) + legacy ({id}.md).
 */
function loadAllEnrichments(projectPath: string, sessionId: string): EnrichmentTab[] {
  const retroDir = join(projectPath, ".sheal", "retros");
  if (!existsSync(retroDir)) return [];

  const tabs: EnrichmentTab[] = [];
  const agents = ["consolidated", "claude", "gemini", "codex", "amp"];

  // Per-agent files
  for (const agent of agents) {
    const path = join(retroDir, `${sessionId}.${agent}.md`);
    if (existsSync(path)) {
      tabs.push({ label: agent, lines: readFileSync(path, "utf-8").split("\n") });
    }
  }

  // Legacy single file (only if no per-agent files found)
  if (tabs.length === 0) {
    const content = loadRetroContent(projectPath, sessionId);
    if (content) {
      tabs.push({ label: "retro", lines: content.split("\n") });
    }
  }

  return tabs;
}

export function RetroDetail({ projectPath, sessionId, onBack, onQuit }: RetroDetailProps) {
  const [scrollPos, setScrollPos] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 7;

  const tabs = useMemo(() => loadAllEnrichments(projectPath, sessionId), [projectPath, sessionId]);

  const lines = tabs[activeTab]?.lines ?? [];

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

    // Tab switching with left/right when multiple enrichments
    if (tabs.length > 1) {
      if (key.leftArrow) {
        setActiveTab((t) => (t > 0 ? t - 1 : tabs.length - 1));
        setScrollPos(0);
        return;
      }
      if (key.rightArrow) {
        setActiveTab((t) => (t < tabs.length - 1 ? t + 1 : 0));
        setScrollPos(0);
        return;
      }
    }

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

  if (tabs.length === 0) {
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
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="magenta">Retro</Text>
          <Text bold>{" "}{sessionId.slice(0, 12)}</Text>
          {tabs.length > 1 && (
            <>
              <Text>{" "}</Text>
              {tabs.map((tab, i) => (
                <Text key={tab.label}>
                  {i > 0 && <Text> </Text>}
                  <Text
                    color={i === activeTab ? (tab.label === "consolidated" ? "green" : "magenta") : undefined}
                    bold={i === activeTab}
                    dimColor={i !== activeTab}
                  >
                    [{tab.label}]
                  </Text>
                </Text>
              ))}
              <Text dimColor> ←/→ switch</Text>
            </>
          )}
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
          const isBold = line.startsWith("**");
          const isBullet = line.trimStart().startsWith("- ");
          const isHuman = line.includes("For the Human");
          const isRule = line.trimStart().startsWith("- When ") || line.trimStart().startsWith("- Before ") || line.trimStart().startsWith("- After ");
          return (
            <Text
              key={scrollPos + i}
              bold={isBold}
              color={isHuman ? "cyan" : isBold ? "magenta" : isRule ? "green" : isBullet ? "yellow" : undefined}
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
        info={`^/v Scroll  PgUp/PgDn  / Search${tabs.length > 1 ? "  ←/→ Agent" : ""}  esc Back`}
      />
    </Box>
  );
}

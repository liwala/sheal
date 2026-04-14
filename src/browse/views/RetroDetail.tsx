import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
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

type EnrichStatus = "idle" | "running" | "done" | "error";

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
      try {
        tabs.push({ label: agent, lines: readFileSync(path, "utf-8").split("\n") });
      } catch {
        // skip files that disappear between existsSync and read
      }
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
  const [enrichStatus, setEnrichStatus] = useState<EnrichStatus>("idle");
  const [enrichError, setEnrichError] = useState("");
  const [enrichProgress, setEnrichProgress] = useState("");
  const [tabsVersion, setTabsVersion] = useState(0);
  const childRef = useRef<ReturnType<typeof spawn> | null>(null);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 7;

  const tabs = useMemo(
    () => loadAllEnrichments(projectPath, sessionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectPath, sessionId, tabsVersion],
  );

  const lines = tabs[activeTab]?.lines ?? [];

  const filteredLines = useMemo(() => {
    if (!searchText) return lines;
    const q = searchText.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, searchText]);

  // Clean up child process on unmount
  useEffect(() => {
    return () => {
      if (childRef.current) {
        childRef.current.kill();
      }
    };
  }, []);

  const startEnrich = useCallback(() => {
    if (enrichStatus === "running") return;

    setEnrichStatus("running");
    setEnrichProgress("Starting enrichment...");
    setEnrichError("");

    const child = spawn(
      process.execPath,
      [
        join(projectPath, "node_modules/.bin/sheal"),
        "retro",
        "-c", sessionId,
        "--enrich",
        "-p", projectPath,
      ],
      {
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        cwd: projectPath,
      },
    );
    childRef.current = child;

    // Try using sheal from PATH if local node_modules doesn't work
    child.on("error", () => {
      // Retry with global sheal
      const retry = spawn("sheal", ["retro", "-c", sessionId, "--enrich", "-p", projectPath], {
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        cwd: projectPath,
      });
      childRef.current = retry;
      wireChild(retry);
    });

    wireChild(child);

    function wireChild(proc: ReturnType<typeof spawn>) {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      proc.stdout?.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const last = chunk.toString().trim().split("\n").pop() ?? "";
        if (last) setEnrichProgress(last.slice(0, 80));
      });
      proc.stderr?.on("data", (chunk: Buffer) => errChunks.push(chunk));
      proc.on("close", (code) => {
        childRef.current = null;
        if (code === 0) {
          setEnrichStatus("done");
          setEnrichProgress("");
          setTabsVersion((v) => v + 1);
        } else {
          const errMsg = Buffer.concat(errChunks).toString().trim() ||
            Buffer.concat(chunks).toString().trim() ||
            `Process exited with code ${code}`;
          setEnrichStatus("error");
          setEnrichError(errMsg.slice(0, 200));
        }
      });
    }
  }, [enrichStatus, projectPath, sessionId]);

  useInput((input, key) => {
    if (searchActive) {
      if (key.escape) { setSearchActive(false); setSearchText(""); }
      else if (key.return) { setSearchActive(false); }
      return;
    }

    if (input === "q") { onBack(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setSearchActive(true); return; }
    if (input === "e" && enrichStatus !== "running") { startEnrich(); return; }

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

  // Enrichment status banner
  const enrichBanner = enrichStatus === "running" ? (
    <Box marginBottom={1}>
      <Text color="cyan">Running enrichment... </Text>
      <Text dimColor>{enrichProgress}</Text>
    </Box>
  ) : enrichStatus === "error" ? (
    <Box marginBottom={1} flexDirection="column">
      <Text color="red">Enrichment failed: {enrichError}</Text>
      <Text dimColor>Press e to retry</Text>
    </Box>
  ) : enrichStatus === "done" && tabs.length > 0 ? (
    <Box marginBottom={1}>
      <Text color="green">Enrichment complete — results loaded</Text>
    </Box>
  ) : null;

  if (tabs.length === 0 && enrichStatus === "idle") {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No retrospective found for session {sessionId.slice(0, 12)}</Text>
        <Text dimColor>Press <Text bold>e</Text> to run enrichment, or run manually: sheal retro -c {sessionId} --enrich</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  if (tabs.length === 0 && enrichStatus !== "idle") {
    return (
      <Box flexDirection="column">
        {enrichBanner}
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

      {enrichBanner}

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
        info={`^/v Scroll  PgUp/PgDn  / Search${tabs.length > 1 ? "  ←/→ Agent" : ""}  e Enrich  esc Back`}
      />
    </Box>
  );
}

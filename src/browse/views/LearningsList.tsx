import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { join } from "node:path";
import { listLearningFiles } from "../utils/retro-status.js";
import type { LearningInfo } from "../utils/retro-status.js";
import { StatusBar } from "../components/StatusBar.js";

interface LearningsListProps {
  projectPath: string;
  projectName: string;
  onBack: () => void;
  onQuit: () => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "red",
  medium: "yellow",
  low: "blue",
};

const CATEGORY_ICONS: Record<string, string> = {
  "missing-context": "?",
  "failure-loop": "!",
  "wasted-effort": "~",
  "environment": "E",
  "workflow": "W",
};

export function LearningsList({ projectPath, projectName, onBack, onQuit }: LearningsListProps) {
  const [cursor, setCursor] = useState(0);
  const [showGlobal, setShowGlobal] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";

  const localLearnings = useMemo(
    () => listLearningFiles(join(projectPath, ".sheal", "learnings")),
    [projectPath],
  );

  const globalLearnings = useMemo(
    () => listLearningFiles(join(homeDir, ".sheal", "learnings")),
    [homeDir],
  );

  const learnings = showGlobal ? globalLearnings : localLearnings;

  useInput((input, key) => {
    if (input === "q") { onBack(); return; }
    if (key.escape) {
      if (expanded !== null) { setExpanded(null); return; }
      onBack();
      return;
    }
    if (input === "g") { setShowGlobal(!showGlobal); setCursor(0); setExpanded(null); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      setExpanded(null);
    } else if (key.downArrow) {
      setCursor((c) => Math.min(learnings.length - 1, c + 1));
      setExpanded(null);
    } else if (key.return && learnings[cursor]) {
      setExpanded(expanded === cursor ? null : cursor);
    }
  });

  // When a learning is expanded, show it as a detail view
  if (expanded !== null && learnings[expanded]) {
    const l = learnings[expanded];
    const sevColor = SEVERITY_COLORS[l.severity] || "white";
    const bodyLines = l.body.split("\n");

    return (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text bold color="green">{l.id}: {l.title}</Text>
          <Box>
            <Text color={sevColor}>{l.severity}</Text>
            <Text dimColor> | {l.category}</Text>
            <Text dimColor> | tags: {l.tags.join(", ")}</Text>
          </Box>
        </Box>

        <Box flexDirection="column">
          {bodyLines.slice(0, maxRows).map((line, i) => (
            <Text key={i} wrap="wrap">{line || " "}</Text>
          ))}
          {bodyLines.length > maxRows && (
            <Text dimColor>... ({bodyLines.length - maxRows} more lines)</Text>
          )}
        </Box>

        <StatusBar
          view="detail"
          searchActive={false}
          info="enter Close  esc Back to list"
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{projectName}</Text>
          <Text bold color="green">{" > Learnings"}</Text>
          <Text dimColor> ({learnings.length})</Text>
        </Box>
        <Box>
          <Text color={showGlobal ? undefined : "green"} bold={!showGlobal}>
            {showGlobal ? " " : ">"} Local ({localLearnings.length})
          </Text>
          <Text>{"  "}</Text>
          <Text color={showGlobal ? "green" : undefined} bold={showGlobal}>
            {showGlobal ? ">" : " "} Global ({globalLearnings.length})
          </Text>
          <Text dimColor>  [g to toggle]</Text>
        </Box>
      </Box>

      <Box flexDirection="column" height={maxRows}>
        {learnings.length === 0 && (
          <Box flexDirection="column">
            <Text dimColor>  No {showGlobal ? "global" : "local"} learnings found.</Text>
            <Text dimColor>  Add: sheal learn add {"\"insight\""} --tags=foo,bar</Text>
          </Box>
        )}
        {learnings.slice(0, maxRows).map((l, i) => {
          const sevColor = SEVERITY_COLORS[l.severity] || "white";
          const catIcon = CATEGORY_ICONS[l.category] || " ";
          return (
            <Box key={l.id} flexDirection="column">
              <Box>
                <Text color={i === cursor ? "green" : undefined} bold={i === cursor}>
                  {i === cursor ? "> " : "  "}
                </Text>
                <Text color={sevColor}>{catIcon}</Text>
                <Text bold={i === cursor}> {l.id}</Text>
                <Text> {l.title.slice(0, 70)}</Text>
              </Box>
              {i === cursor && l.tags.length > 0 && (
                <Text dimColor>    tags: {l.tags.join(", ")}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <StatusBar
        view="detail"
        searchActive={false}
        info="^/v Navigate  enter View  g Local/Global  esc Back"
      />
    </Box>
  );
}

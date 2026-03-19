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
    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "g") { setShowGlobal(!showGlobal); setCursor(0); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(learnings.length - 1, c + 1));
    }
  });

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
        info="^/v Navigate  g Local/Global  esc Back"
      />
    </Box>
  );
}

import { Box, Text, useInput } from "ink";
import { useMemo } from "react";
import type { NativeProject } from "../../entire/claude-native.js";
import { countRetros, countLearnings, countAsks } from "../utils/retro-status.js";
import { useState } from "react";
import { StatusBar } from "../components/StatusBar.js";

const AGENT_COLORS: Record<string, string> = {
  claude: "blue",
  codex: "yellow",
  amp: "magenta",
};

interface ProjectOverviewProps {
  project: NativeProject;
  onViewSessions: () => void;
  onViewRetros: () => void;
  onViewLearnings: () => void;
  onViewAsks: () => void;
  onBack: () => void;
  onQuit: () => void;
}

interface MenuItem {
  label: string;
  count: number;
  color?: string;
  action: () => void;
}

export function ProjectOverview({
  project,
  onViewSessions,
  onViewRetros,
  onViewLearnings,
  onViewAsks,
  onBack,
  onQuit,
}: ProjectOverviewProps) {
  const [cursor, setCursor] = useState(0);

  const { retroCount, learningCount, askCount } = useMemo(() => ({
    retroCount: countRetros(project.projectPath),
    learningCount: countLearnings(project.projectPath),
    askCount: countAsks(project.projectPath),
  }), [project.projectPath]);

  const agents = project.agents || [];

  const items: MenuItem[] = [
    { label: "Sessions", count: project.sessionCount, action: onViewSessions },
    { label: "Retros", count: retroCount, color: "magenta", action: onViewRetros },
    { label: "Learnings", count: learningCount.local, color: "green", action: onViewLearnings },
    { label: "Asks", count: askCount, color: "blueBright", action: onViewAsks },
  ];

  useInput((input, key) => {
    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (key.return) {
      items[cursor].action();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{project.name}</Text>
        </Box>
        <Text dimColor>{project.projectPath}</Text>
        {agents.length > 0 && (
          <Box>
            {agents.map((a, i) => (
              <Text key={a.agent}>
                {i > 0 && <Text>{" "}</Text>}
                <Text color={(AGENT_COLORS[a.agent] || "white") as any}>{a.agent}</Text>
                <Text dimColor> ({a.sessionCount})</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>

      <Box flexDirection="column">
        {items.map((item, i) => (
          <Box key={item.label}>
            <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
              {i === cursor ? "> " : "  "}
            </Text>
            <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
              {item.label}
            </Text>
            <Text color={item.count > 0 ? item.color : undefined} dimColor={item.count === 0}>
              {" "}({item.count})
            </Text>
          </Box>
        ))}
      </Box>

      {learningCount.global > 0 && (
        <Box marginTop={1}>
          <Text dimColor>{learningCount.global} global learning(s) also available</Text>
        </Box>
      )}

      <StatusBar view="detail" searchActive={false} info="^/v Navigate  enter Select  esc Back  q Quit" />
    </Box>
  );
}

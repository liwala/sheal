import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { listNativeSessionsBySlug } from "../../entire/claude-native.js";
import type { NativeProject } from "../../entire/claude-native.js";
import type { CheckpointInfo } from "../../entire/types.js";
import { hasRetro, countRetros, countLearnings } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface SessionListProps {
  project: NativeProject;
  onSelect: (session: CheckpointInfo) => void;
  onBack: () => void;
  onSearch: () => void;
  onQuit: () => void;
  agentFilter: string | null;
  onAgentFilterToggle: () => void;
  onViewRetros: () => void;
  onViewLearnings: () => void;
}

const DEFAULT_LIMIT = 10;

export function SessionList({
  project,
  onSelect,
  onBack,
  onSearch,
  onQuit,
  agentFilter,
  onAgentFilterToggle,
  onViewRetros,
  onViewLearnings,
}: SessionListProps) {
  const [cursor, setCursor] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [filterActive, setFilterActive] = useState(false);
  const [filterText, setFilterText] = useState("");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 10;

  const allSessions = useMemo(
    () => listNativeSessionsBySlug(project.slug),
    [project.slug],
  );

  // Check which sessions have retros
  const retroSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSessions) {
      if (hasRetro(project.projectPath, s.sessionId)) {
        set.add(s.sessionId);
      }
    }
    return set;
  }, [allSessions, project.projectPath]);

  const { retroCount, learningCount } = useMemo(() => ({
    retroCount: countRetros(project.projectPath),
    learningCount: countLearnings(project.projectPath),
  }), [project.projectPath]);

  const filtered = useMemo(() => {
    let result = allSessions;
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(
        (s) =>
          s.sessionId.toLowerCase().includes(q) ||
          (s.title?.toLowerCase().includes(q) ?? false),
      );
    }
    if (agentFilter) {
      result = result.filter((s) =>
        s.agent?.toLowerCase().includes(agentFilter.toLowerCase()),
      );
    }
    return result;
  }, [allSessions, filterText, agentFilter]);

  const visible = showAll ? filtered : filtered.slice(0, DEFAULT_LIMIT);
  const hasMore = filtered.length > DEFAULT_LIMIT && !showAll;

  useInput((input, key) => {
    if (filterActive) {
      if (key.escape) {
        setFilterActive(false);
        setFilterText("");
      } else if (key.return) {
        setFilterActive(false);
      }
      return;
    }

    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setFilterActive(true); return; }
    if (input === "s") { onSearch(); return; }
    if (input === "a") { onAgentFilterToggle(); return; }
    if (input === "m") { setShowAll(!showAll); return; }
    if (input === "r") { onViewRetros(); return; }
    if (input === "l") { onViewLearnings(); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    } else if (key.return && visible[cursor]) {
      onSelect(visible[cursor]);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{project.name}</Text>
          <Text bold>{" > Sessions"}</Text>
          <Text dimColor> ({filtered.length} of {allSessions.length})</Text>
          {agentFilter && <Text color="blue"> [{agentFilter}]</Text>}
        </Box>
        <Text dimColor>{project.projectPath}</Text>
        <Box>
          {retroCount > 0 && <Text color="magenta">{retroCount} retro(s) [r]  </Text>}
          {learningCount.local > 0 && <Text color="green">{learningCount.local} learning(s) [l]  </Text>}
          {learningCount.global > 0 && <Text dimColor>{learningCount.global} global learning(s)</Text>}
        </Box>
      </Box>

      {filterActive && (
        <SearchBar label="Filter" value={filterText} onChange={setFilterText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {visible.slice(0, maxRows).map((s, i) => (
          <Box key={s.sessionId}>
            <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
              {i === cursor ? "> " : "  "}
              {s.sessionId.slice(0, 12)}
            </Text>
            <Text dimColor> {s.createdAt?.slice(0, 16) || ""}</Text>
            {retroSet.has(s.sessionId) && <Text color="magenta"> [R]</Text>}
            {s.title && <Text> {s.title.slice(0, 50)}</Text>}
          </Box>
        ))}
        {hasMore && (
          <Text dimColor>  ... {filtered.length - DEFAULT_LIMIT} more (press m)</Text>
        )}
        {visible.length === 0 && <Text dimColor>  No sessions match filters</Text>}
      </Box>

      <StatusBar view="sessions" searchActive={filterActive} />
    </Box>
  );
}

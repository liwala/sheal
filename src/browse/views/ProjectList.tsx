import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { listAllNativeProjects } from "../../entire/claude-native.js";
import type { NativeProject } from "../../entire/claude-native.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface ProjectListProps {
  onSelect: (project: NativeProject) => void;
  onSearch: () => void;
  onQuit: () => void;
  agentFilter: string | null;
  onAgentFilterToggle: () => void;
  onViewLearnings: (project: NativeProject) => void;
  onViewRetros: (project: NativeProject) => void;
  initialFilter?: string;
}

const DEFAULT_LIMIT = 10;

export function ProjectList({
  onSelect,
  onSearch,
  onQuit,
  agentFilter,
  onAgentFilterToggle,
  onViewLearnings,
  onViewRetros,
  initialFilter,
}: ProjectListProps) {
  const [cursor, setCursor] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [filterActive, setFilterActive] = useState(!!initialFilter);
  const [filterText, setFilterText] = useState(initialFilter || "");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const allProjects = useMemo(() => listAllNativeProjects(), []);

  const filtered = useMemo(() => {
    let result = allProjects;
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.projectPath.toLowerCase().includes(q),
      );
    }
    return result;
  }, [allProjects, filterText]);

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
    if (input === "/") { setFilterActive(true); return; }
    if (input === "s") { onSearch(); return; }
    if (input === "a") { onAgentFilterToggle(); return; }
    if (input === "m") { setShowAll(!showAll); return; }
    if (input === "l" && visible[cursor]) { onViewLearnings(visible[cursor]); return; }
    if (input === "r" && visible[cursor]) { onViewRetros(visible[cursor]); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    } else if (key.return && visible[cursor]) {
      onSelect(visible[cursor]);
    }
  });

  const totalSessions = allProjects.reduce((s, p) => s + p.sessionCount, 0);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {filtered.length} project(s), {totalSessions} sessions
        </Text>
        <Text dimColor> (Claude Code native)</Text>
        {agentFilter && <Text color="blue"> [{agentFilter}]</Text>}
      </Box>

      {filterActive && (
        <SearchBar label="Filter" value={filterText} onChange={setFilterText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {visible.slice(0, maxRows).map((p, i) => (
          <Box key={p.slug}>
            <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
              {i === cursor ? "> " : "  "}
              {p.name}
            </Text>
            <Text dimColor>
              {" "}({p.sessionCount}) {p.lastModified?.slice(0, 10) || ""}
            </Text>
          </Box>
        ))}
        {hasMore && (
          <Text dimColor>  ... {filtered.length - DEFAULT_LIMIT} more (press m)</Text>
        )}
      </Box>

      <StatusBar view="projects" searchActive={filterActive} />
    </Box>
  );
}

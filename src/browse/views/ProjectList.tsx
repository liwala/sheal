import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { listAllNativeProjects } from "../../entire/claude-native.js";
import type { NativeProject } from "../../entire/claude-native.js";
import { listCodexProjects } from "../../entire/codex-native.js";
import { listAmpProjects } from "../../entire/amp-native.js";
import { countRetros, countLearnings, countAsks } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

const AGENT_COLORS: Record<string, string> = {
  claude: "blue",
  codex: "yellow",
  amp: "magenta",
};

function agentFromSlug(slug: string): string {
  if (slug.startsWith("codex:")) return "codex";
  if (slug.startsWith("amp:")) return "amp";
  return "claude";
}

/**
 * Merge projects from different agents that share the same projectPath.
 */
function mergeProjects(all: NativeProject[]): NativeProject[] {
  const byPath = new Map<string, NativeProject[]>();

  for (const p of all) {
    // Use projectPath as the merge key for real paths, slug for slug-only
    const key = p.projectPath.startsWith("/") ? p.projectPath : p.slug;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key)!.push(p);
  }

  const merged: NativeProject[] = [];
  for (const [, projects] of byPath) {
    if (projects.length === 1) {
      const p = projects[0];
      merged.push({
        ...p,
        agents: [{ agent: agentFromSlug(p.slug), slug: p.slug, sessionCount: p.sessionCount }],
      });
    } else {
      // Merge: use the best name, combine counts
      const agents = projects.map((p) => ({
        agent: agentFromSlug(p.slug),
        slug: p.slug,
        sessionCount: p.sessionCount,
      }));
      const totalSessions = projects.reduce((s, p) => s + p.sessionCount, 0);
      const latest = projects.reduce((a, b) => a.lastModified > b.lastModified ? a : b);
      // Prefer the project with a real path for the name
      const best = projects.find((p) => p.projectPath.startsWith("/")) || projects[0];

      merged.push({
        slug: best.slug, // primary slug for routing
        projectPath: best.projectPath,
        name: best.name,
        sessionCount: totalSessions,
        lastModified: latest.lastModified,
        agents,
      });
    }
  }

  merged.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return merged;
}

interface ProjectListProps {
  onSelect: (project: NativeProject) => void;
  onSearch: () => void;
  onQuit: () => void;
  agentFilter: string | null;
  onAgentFilterToggle: () => void;
  initialFilter?: string;
}

export function ProjectList({
  onSelect,
  onSearch,
  onQuit,
  agentFilter,
  onAgentFilterToggle,
  initialFilter,
}: ProjectListProps) {
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filterActive, setFilterActive] = useState(!!initialFilter);
  const [filterText, setFilterText] = useState(initialFilter || "");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 6;

  const allProjects = useMemo(() => {
    const claude = listAllNativeProjects();
    const codex = listCodexProjects();
    const amp = listAmpProjects();
    const all: NativeProject[] = [...claude, ...codex, ...amp];
    return mergeProjects(all);
  }, []);

  const projectStats = useMemo(() => {
    const stats = new Map<string, { retros: number; learnings: number; asks: number }>();
    for (const p of allProjects) {
      if (p.projectPath.startsWith("/")) {
        const retros = countRetros(p.projectPath);
        const lc = countLearnings(p.projectPath);
        const asks = countAsks(p.projectPath);
        if (retros > 0 || lc.local > 0 || asks > 0) {
          stats.set(p.projectPath, { retros, learnings: lc.local, asks });
        }
      }
    }
    return stats;
  }, [allProjects]);

  const filtered = useMemo(() => {
    let result = allProjects;
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.projectPath.toLowerCase().includes(q),
      );
    }
    if (agentFilter) {
      result = result.filter(
        (p) => p.agents?.some((a) => a.agent === agentFilter),
      );
    }
    return result;
  }, [allProjects, filterText, agentFilter]);

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

    if (key.upArrow) {
      setCursor((c) => {
        const next = Math.max(0, c - 1);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
    } else if (key.downArrow) {
      setCursor((c) => {
        const next = Math.min(filtered.length - 1, c + 1);
        if (next >= scrollOffset + maxRows) setScrollOffset(next - maxRows + 1);
        return next;
      });
    } else if (key.return && filtered[cursor]) {
      onSelect(filtered[cursor]);
    }
  });

  const totalSessions = allProjects.reduce((s, p) => s + p.sessionCount, 0);
  const windowItems = filtered.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {filtered.length} project(s), {totalSessions} sessions
        </Text>
        {agentFilter && <Text color={(AGENT_COLORS[agentFilter] || "white") as any}> [{agentFilter}]</Text>}
      </Box>

      {filterActive && (
        <SearchBar label="Filter" value={filterText} onChange={setFilterText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {windowItems.map((p, i) => {
          const globalIdx = scrollOffset + i;
          const agents = p.agents || [{ agent: agentFromSlug(p.slug), slug: p.slug, sessionCount: p.sessionCount }];
          const stats = projectStats.get(p.projectPath);
          return (
            <Box key={p.projectPath + p.slug}>
              <Text color={globalIdx === cursor ? "cyan" : undefined} bold={globalIdx === cursor}>
                {globalIdx === cursor ? "> " : "  "}
                {p.name}
              </Text>
              <Text> </Text>
              {agents.map((a, j) => (
                <Text key={a.agent} color={(AGENT_COLORS[a.agent] || "white") as any}>
                  {j > 0 ? ", " : "["}
                  {a.agent}
                </Text>
              ))}
              <Text>{"]"}</Text>
              <Text dimColor> {p.sessionCount}s</Text>
              {stats && stats.retros > 0 && <Text color="magenta"> {stats.retros}r</Text>}
              {stats && stats.learnings > 0 && <Text color="green"> {stats.learnings}l</Text>}
              {stats && stats.asks > 0 && <Text color="blueBright"> {stats.asks}a</Text>}
              <Text dimColor> {p.lastModified?.slice(0, 10) || ""}</Text>
            </Box>
          );
        })}
        {filtered.length > maxRows && scrollOffset + maxRows < filtered.length && (
          <Text dimColor>  ↓ {filtered.length - scrollOffset - maxRows} more</Text>
        )}
      </Box>

      <StatusBar view="projects" searchActive={filterActive} />
    </Box>
  );
}

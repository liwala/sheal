import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo, useEffect } from "react";
import {
  hasEntireBranch,
  listAmpSessionsForProject,
  listCheckpoints,
  listCodexSessionsForProject,
  listGeminiSessionsForProject,
  listNativeSessionsBySlug,
} from "@liwala/agent-sessions";
import type { CheckpointInfo, NativeProject } from "@liwala/agent-sessions";
import { stitchSessions, formatDuration, shortAgent, DEFAULT_GAP_MS } from "../utils/stitch.js";
import type { TaskGroup } from "../utils/stitch.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

const AGENT_COLORS: Record<string, string> = {
  "Claude Code": "blue",
  "Codex": "yellow",
  "Amp": "magenta",
  "Gemini": "green",
  "Entire.io": "greenBright",
};

interface TimelineProps {
  project: NativeProject;
  onSelect: (session: CheckpointInfo) => void;
  onBack: () => void;
  onQuit: () => void;
  agentFilter: string | null;
  onAgentFilterToggle: () => void;
}

type Row =
  | { kind: "group"; groupIdx: number }
  | { kind: "session"; groupIdx: number; sessionIdx: number };

export function Timeline({
  project,
  onSelect,
  onBack,
  onQuit,
  agentFilter,
  onAgentFilterToggle,
}: TimelineProps) {
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterActive, setFilterActive] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [hidePiped, setHidePiped] = useState(true);
  const [hideEntire, setHideEntire] = useState(true);
  const [gapHours, setGapHours] = useState(DEFAULT_GAP_MS / (60 * 60 * 1000));
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 9;

  // Load sessions from every agent source for this project (sync).
  const syncSessions = useMemo(() => {
    const sessions: CheckpointInfo[] = [];
    const agents = project.agents || [];

    for (const a of agents) {
      if (a.agent === "codex") {
        sessions.push(...listCodexSessionsForProject(project.projectPath));
      } else if (a.agent === "amp") {
        sessions.push(...listAmpSessionsForProject(project.projectPath));
      } else if (a.agent === "gemini") {
        sessions.push(...listGeminiSessionsForProject(project.projectPath));
      } else {
        sessions.push(...listNativeSessionsBySlug(a.slug));
      }
    }

    if (agents.length === 0) {
      if (project.slug.startsWith("codex:")) {
        sessions.push(...listCodexSessionsForProject(project.projectPath));
      } else if (project.slug.startsWith("amp:")) {
        sessions.push(...listAmpSessionsForProject(project.projectPath));
      } else if (project.slug.startsWith("gemini:")) {
        sessions.push(...listGeminiSessionsForProject(project.projectPath));
      } else {
        sessions.push(...listNativeSessionsBySlug(project.slug));
      }
    }

    return sessions;
  }, [project.slug, project.projectPath, project.agents]);

  const [entireSessions, setEntireSessions] = useState<CheckpointInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!project.projectPath.startsWith("/")) return;
    hasEntireBranch(project.projectPath).then((has) => {
      if (!has || cancelled) return;
      listCheckpoints(project.projectPath).then((checkpoints) => {
        if (cancelled) return;
        const marked = checkpoints.map((cp) => ({
          ...cp,
          agent: "Entire.io" as const,
          sessionId: cp.checkpointId,
        }));
        setEntireSessions(marked);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [project.projectPath]);

  const allSessions = useMemo(() => [...syncSessions, ...entireSessions], [syncSessions, entireSessions]);

  const entireCount = useMemo(() => allSessions.filter((s) => s.agent === "Entire.io").length, [allSessions]);
  const pipedCount = useMemo(() => allSessions.filter((s) => s.title?.startsWith("[piped]")).length, [allSessions]);

  const filteredSessions = useMemo(() => {
    let result = allSessions;
    if (hidePiped) result = result.filter((s) => !s.title?.startsWith("[piped]"));
    if (hideEntire) result = result.filter((s) => s.agent !== "Entire.io");
    if (agentFilter) {
      result = result.filter((s) => s.agent?.toLowerCase().includes(agentFilter.toLowerCase()));
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(
        (s) =>
          s.sessionId.toLowerCase().includes(q) ||
          (s.title?.toLowerCase().includes(q) ?? false) ||
          (s.agent?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [allSessions, filterText, agentFilter, hidePiped, hideEntire]);

  const groups: TaskGroup[] = useMemo(
    () => stitchSessions(filteredSessions, gapHours * 60 * 60 * 1000),
    [filteredSessions, gapHours],
  );

  // Build flat visible rows (group headers plus expanded children).
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    groups.forEach((g, gi) => {
      out.push({ kind: "group", groupIdx: gi });
      if (expanded.has(g.id)) {
        g.sessions.forEach((_, si) => out.push({ kind: "session", groupIdx: gi, sessionIdx: si }));
      }
    });
    return out;
  }, [groups, expanded]);

  // Clamp cursor when rows shrink (e.g., collapsing a group).
  useEffect(() => {
    if (cursor >= rows.length) setCursor(Math.max(0, rows.length - 1));
    if (scrollOffset > cursor) setScrollOffset(cursor);
    if (scrollOffset + maxRows <= cursor) setScrollOffset(Math.max(0, cursor - maxRows + 1));
  }, [rows.length, cursor, scrollOffset, maxRows]);

  const toggleExpand = (groupId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(groups.map((g) => g.id)));
  const collapseAll = () => setExpanded(new Set());

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
    if (input === "a") { onAgentFilterToggle(); return; }
    if (input === "p") { setHidePiped(!hidePiped); setCursor(0); setScrollOffset(0); return; }
    if (input === "e") { setHideEntire(!hideEntire); setCursor(0); setScrollOffset(0); return; }
    if (input === "E") { expandAll(); return; }
    if (input === "C") { collapseAll(); return; }
    if (input === "+") { setGapHours((h) => Math.min(24, h + 1)); return; }
    if (input === "-") { setGapHours((h) => Math.max(1, h - 1)); return; }

    if (key.upArrow) {
      setCursor((c) => {
        const next = Math.max(0, c - 1);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
      return;
    }
    if (key.downArrow) {
      setCursor((c) => {
        const next = Math.min(rows.length - 1, c + 1);
        if (next >= scrollOffset + maxRows) setScrollOffset(next - maxRows + 1);
        return next;
      });
      return;
    }

    const row = rows[cursor];
    if (!row) return;

    if (key.rightArrow) {
      if (row.kind === "group") {
        const g = groups[row.groupIdx];
        if (!expanded.has(g.id)) toggleExpand(g.id);
      }
      return;
    }
    if (key.leftArrow) {
      if (row.kind === "group") {
        const g = groups[row.groupIdx];
        if (expanded.has(g.id)) toggleExpand(g.id);
      } else {
        // On a session row — left arrow jumps up to and collapses parent group.
        const g = groups[row.groupIdx];
        toggleExpand(g.id);
        // Move cursor to the parent group header.
        const headerIdx = rows.findIndex((r) => r.kind === "group" && r.groupIdx === row.groupIdx);
        if (headerIdx >= 0) setCursor(headerIdx);
      }
      return;
    }
    if (key.return) {
      if (row.kind === "group") {
        const g = groups[row.groupIdx];
        if (g.sessions.length === 1) {
          onSelect(g.sessions[0]);
        } else {
          toggleExpand(g.id);
        }
      } else {
        const s = groups[row.groupIdx].sessions[row.sessionIdx];
        onSelect(s);
      }
    }
  });

  const windowRows = rows.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{project.name}</Text>
          <Text bold>{" > Timeline"}</Text>
          <Text dimColor> ({groups.length} task{groups.length === 1 ? "" : "s"}, {filteredSessions.length} of {allSessions.length} sessions)</Text>
          {agentFilter && <Text color="blue"> [{agentFilter}]</Text>}
        </Box>
        <Box>
          <Text dimColor>gap {gapHours}h (+/-)</Text>
          {entireCount > 0 && <Text dimColor>  |  {hideEntire ? `${entireCount} entire.io hidden, e` : `showing ${entireCount} entire.io, e`}</Text>}
          {pipedCount > 0 && <Text dimColor>  |  {hidePiped ? `${pipedCount} piped hidden, p` : `showing ${pipedCount} piped, p`}</Text>}
        </Box>
      </Box>

      {filterActive && <SearchBar label="Filter" value={filterText} onChange={setFilterText} />}

      <Box flexDirection="column" height={maxRows}>
        {windowRows.map((row, i) => {
          const globalIdx = scrollOffset + i;
          const isCursor = globalIdx === cursor;
          if (row.kind === "group") {
            const g = groups[row.groupIdx];
            const isOpen = expanded.has(g.id);
            const indicator = g.sessions.length > 1 ? (isOpen ? "v" : ">") : " ";
            const start = g.startAt.slice(0, 16);
            const durationMs = new Date(g.endAt).getTime() - new Date(g.startAt).getTime();
            const durStr = g.sessions.length > 1 ? ` (${formatDuration(durationMs)})` : "";
            return (
              <Box key={`g-${g.id}`}>
                <Text color={isCursor ? "cyan" : undefined} bold={isCursor}>
                  {isCursor ? "> " : "  "}{indicator} {start}{durStr}
                </Text>
                {g.agents.length > 0 && (
                  <Text>
                    {" ["}
                    {g.agents.map((a, idx) => (
                      <Text key={a}>
                        {idx > 0 && <Text dimColor>,</Text>}
                        <Text color={(AGENT_COLORS[a] || "white") as any}>{shortAgent(a)}</Text>
                      </Text>
                    ))}
                    <Text>]</Text>
                  </Text>
                )}
                <Text dimColor> {g.sessions.length}s</Text>
                {g.filesTouched.length > 0 && <Text dimColor> {g.filesTouched.length}f</Text>}
                {g.title && <Text> {truncate(g.title, 60)}</Text>}
              </Box>
            );
          }
          // Session row — indented under its group.
          const s = groups[row.groupIdx].sessions[row.sessionIdx];
          const time = s.createdAt.slice(11, 16);
          const agentColor = AGENT_COLORS[s.agent || ""] || "white";
          return (
            <Box key={`s-${s.sessionId}`}>
              <Text color={isCursor ? "cyan" : undefined} bold={isCursor}>
                {isCursor ? "> " : "  "}    {time}
              </Text>
              <Text color={agentColor as any}> [{shortAgent(s.agent)}]</Text>
              <Text dimColor> {s.sessionId.slice(0, 8)}</Text>
              {s.filesTouched.length > 0 && <Text dimColor> {s.filesTouched.length}f</Text>}
              {s.title && <Text dimColor> {truncate(s.title, 50)}</Text>}
            </Box>
          );
        })}
        {rows.length === 0 && <Text dimColor>  No sessions match filters</Text>}
        {rows.length > maxRows && scrollOffset + maxRows < rows.length && (
          <Text dimColor>  ↓ {rows.length - scrollOffset - maxRows} more</Text>
        )}
      </Box>

      <StatusBar
        view="timeline"
        searchActive={filterActive}
        info="→ Expand  ← Collapse  E/C Expand/Collapse all  +/- Gap"
      />
    </Box>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

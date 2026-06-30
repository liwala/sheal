import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo, useEffect } from "react";
import {
  hasEntireBranch,
  listAmpSessionsForProject,
  listCheckpoints,
  listGeminiSessionsForProject,
} from "@liwala/agent-sessions";
import type { CheckpointInfo, NativeProject } from "@liwala/agent-sessions";
import { hasRetro } from "../utils/retro-status.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { normalizeSessionSource } from "../../sessions/raw-registry.js";
import {
  formatSessionBackupBadge,
  getSessionImportOffer,
  listProjectSessionInventory,
} from "../../sessions/inventory.js";
import type { SessionInventoryItem } from "../../sessions/inventory.js";

const AGENT_COLORS: Record<string, string> = {
  "Claude Code": "blue",
  "Codex": "yellow",
  "Amp": "magenta",
  "Gemini": "green",
  "Entire.io": "greenBright",
};

interface SessionListProps {
  project: NativeProject;
  onSelect: (session: CheckpointInfo) => void;
  onBack: () => void;
  onSearch: () => void;
  onQuit: () => void;
  agentFilter: string | null;
  onAgentFilterToggle: () => void;
}

type BrowseSessionInfo = CheckpointInfo & Partial<Pick<SessionInventoryItem, "registryStatus" | "rawSessionId">>;

export function SessionList({
  project,
  onSelect,
  onBack,
  onSearch,
  onQuit,
  agentFilter,
  onAgentFilterToggle,
}: SessionListProps) {
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hidePiped, setHidePiped] = useState(true);
  const [hideEntire, setHideEntire] = useState(true);
  const [filterActive, setFilterActive] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const [importNotice, setImportNotice] = useState("");
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  // Load sessions from ALL agent sources for this project (sync sources)
  const syncSessions = useMemo(() => {
    const sessions: BrowseSessionInfo[] = [];
    const agents = project.agents || [];
    const hasAgents = agents.length > 0;
    const includeClaude = hasAgents
      ? agents.some((a) => a.agent === "claude")
      : !project.slug.startsWith("codex:") && !project.slug.startsWith("amp:") && !project.slug.startsWith("gemini:");
    const includeCodex = hasAgents
      ? agents.some((a) => a.agent === "codex")
      : project.slug.startsWith("codex:");
    const inventory = project.projectPath.startsWith("/") && (includeClaude || includeCodex)
      ? listProjectSessionInventory(project.projectPath)
      : [];

    if (includeClaude) {
      sessions.push(...inventory.filter((session) => session.agent === "Claude Code"));
    }
    if (includeCodex) {
      sessions.push(...inventory.filter((session) => session.agent === "Codex"));
    }

    for (const a of agents) {
      if (a.agent === "amp") {
        sessions.push(...listAmpSessionsForProject(project.projectPath));
      } else if (a.agent === "gemini") {
        sessions.push(...listGeminiSessionsForProject(project.projectPath));
      }
    }

    // Fallback: if no agents info, use slug-based routing
    if (agents.length === 0) {
      if (project.slug.startsWith("amp:")) {
        sessions.push(...listAmpSessionsForProject(project.projectPath));
      } else if (project.slug.startsWith("gemini:")) {
        sessions.push(...listGeminiSessionsForProject(project.projectPath));
      }
    }

    return sessions;
  }, [project.slug, project.projectPath, project.agents, inventoryVersion]);

  // Load Entire.io sessions asynchronously
  const [entireSessions, setEntireSessions] = useState<BrowseSessionInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!project.projectPath.startsWith("/")) return;
    hasEntireBranch(project.projectPath).then((has) => {
      if (!has || cancelled) return;
      listCheckpoints(project.projectPath).then((checkpoints) => {
        if (cancelled) return;
        // Mark Entire.io sessions so they can be routed to the right detail view
        const marked = checkpoints.map((cp) => ({
          ...cp,
          agent: "Entire.io" as const,
          // Use checkpointId as sessionId for routing
          sessionId: cp.checkpointId,
        }));
        setEntireSessions(marked);
      });
    });
    return () => { cancelled = true; };
  }, [project.projectPath]);

  const allSessions = useMemo<BrowseSessionInfo[]>(() => {
    const sessions = [...syncSessions, ...entireSessions];
    sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sessions;
  }, [syncSessions, entireSessions]);

  const sessionImportOffer = useMemo(() => getSessionImportOffer(syncSessions), [syncSessions]);

  const retroSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSessions) {
      if (hasRetro(project.projectPath, s.sessionId)) {
        set.add(s.sessionId);
      }
    }
    return set;
  }, [allSessions, project.projectPath]);

  const hasMultipleAgents = (project.agents?.length ?? 0) > 1;

  const entireCount = useMemo(() => allSessions.filter((s) => s.agent === "Entire.io").length, [allSessions]);
  const pipedCount = useMemo(() => allSessions.filter((s) => s.title?.startsWith("[piped]")).length, [allSessions]);

  const filtered = useMemo(() => {
    let result = allSessions;
    if (hidePiped) {
      result = result.filter((s) => !s.title?.startsWith("[piped]"));
    }
    if (hideEntire) {
      result = result.filter((s) => s.agent !== "Entire.io");
    }
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
  }, [allSessions, filterText, agentFilter, hidePiped, hideEntire]);

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
    if (input === "p") { setHidePiped(!hidePiped); setCursor(0); setScrollOffset(0); return; }
    if (input === "e") { setHideEntire(!hideEntire); setCursor(0); setScrollOffset(0); return; }
    if (input === "i" && sessionImportOffer && project.projectPath.startsWith("/")) {
      const liveOnlyCount = syncSessions.filter((session) => session.registryStatus === "live-home-only").length;
      normalizeSessionSource({ projectRoot: project.projectPath });
      setImportNotice(`Added ${liveOnlyCount} session(s) to .sheal/sessions/raw/.`);
      setInventoryVersion((version) => version + 1);
      return;
    }

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

  const windowItems = filtered.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{project.name}</Text>
          <Text bold>{" > Sessions"}</Text>
          <Text dimColor> ({filtered.length} of {allSessions.length})</Text>
          {agentFilter && <Text color="blue"> [{agentFilter}]</Text>}
        </Box>
        <Box>
          {entireCount > 0 && <Text dimColor>{hideEntire ? `${entireCount} entire.io hidden, e to show` : `showing ${entireCount} entire.io, e to hide`}</Text>}
          {entireCount > 0 && pipedCount > 0 && <Text dimColor> | </Text>}
          {pipedCount > 0 && <Text dimColor>{hidePiped ? `${pipedCount} piped hidden, p to show` : `showing ${pipedCount} piped, p to hide`}</Text>}
        </Box>
        {sessionImportOffer && <Text color="yellow">{sessionImportOffer}</Text>}
        {importNotice && <Text color="green">{importNotice}</Text>}
      </Box>

      {filterActive && (
        <SearchBar label="Filter" value={filterText} onChange={setFilterText} />
      )}

      <Box flexDirection="column" height={maxRows}>
        {windowItems.map((s, i) => {
          const globalIdx = scrollOffset + i;
          const isPiped = s.title?.startsWith("[piped]") ?? false;
          const agentColor = AGENT_COLORS[s.agent || ""] || "white";
          const backupBadge = s.registryStatus ? formatSessionBackupBadge(s as SessionInventoryItem) : "";
          return (
          <Box key={`${s.agent}-${s.sessionId}`}>
            <Text color={globalIdx === cursor ? "cyan" : undefined} bold={globalIdx === cursor} dimColor={isPiped && globalIdx !== cursor}>
              {globalIdx === cursor ? "> " : "  "}
              {s.sessionId.slice(0, 12)}
            </Text>
            <Text dimColor> {s.createdAt?.slice(0, 16) || ""}</Text>
            {hasMultipleAgents && s.agent && (
              <Text color={agentColor as any}> [{s.agent === "Claude Code" ? "claude" : s.agent.toLowerCase()}]</Text>
            )}
            {retroSet.has(s.sessionId) && <Text color="magenta"> [R]</Text>}
            {backupBadge && <Text color="yellow"> {backupBadge}</Text>}
            {s.filesTouched.length > 0 && <Text dimColor> {s.filesTouched.length}f</Text>}
            {s.title && <Text dimColor={isPiped && globalIdx !== cursor}> {s.title.slice(0, 50)}</Text>}
          </Box>
          );
        })}
        {filtered.length > maxRows && scrollOffset + maxRows < filtered.length && (
          <Text dimColor>  ↓ {filtered.length - scrollOffset - maxRows} more</Text>
        )}
        {filtered.length === 0 && <Text dimColor>  No sessions match filters</Text>}
      </Box>

      <StatusBar view="sessions" searchActive={filterActive} />
    </Box>
  );
}

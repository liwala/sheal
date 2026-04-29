/**
 * Session stitching: group sessions from multiple agents into "task timelines"
 * based on time proximity within the same project.
 *
 * The idea: when a user switches between Claude, Codex, Amp, and Gemini on the
 * same task, the raw session list shows them as unrelated entries. Stitching
 * merges consecutive sessions whose start times fall within a configurable gap
 * window into a single TaskGroup.
 */
import type { CheckpointInfo } from "@liwala/agent-sessions";

/** Default gap threshold: sessions starting within 2 hours of each other are stitched. */
export const DEFAULT_GAP_MS = 2 * 60 * 60 * 1000;

export interface TaskGroup {
  /** Stable id derived from the first session in the group. */
  id: string;
  /** Human-readable label from the first session's prompt. */
  title: string;
  /** createdAt of the earliest session in the group. */
  startAt: string;
  /** createdAt of the latest session in the group. */
  endAt: string;
  /** Sessions in chronological order (oldest first). */
  sessions: CheckpointInfo[];
  /** Unique agents represented in this group. */
  agents: string[];
  /** Union of filesTouched across all sessions. */
  filesTouched: string[];
}

/**
 * Stitch sessions into TaskGroups by time proximity.
 *
 * Sessions are sorted ascending by createdAt. Two consecutive sessions are
 * merged into the same group if their start times differ by no more than
 * gapMs. A session that extends the group's "last session" time is chained —
 * groups can therefore span longer than gapMs as long as intermediate gaps
 * stay within the threshold.
 *
 * Returned groups are in reverse chronological order (most recent first).
 */
export function stitchSessions(
  sessions: CheckpointInfo[],
  gapMs: number = DEFAULT_GAP_MS,
): TaskGroup[] {
  if (sessions.length === 0) return [];

  const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const groups: TaskGroup[] = [];
  let current: CheckpointInfo[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1];
    const next = sorted[i];
    const prevTime = new Date(prev.createdAt).getTime();
    const nextTime = new Date(next.createdAt).getTime();

    if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && nextTime - prevTime <= gapMs) {
      current.push(next);
    } else {
      groups.push(makeGroup(current));
      current = [next];
    }
  }
  groups.push(makeGroup(current));

  return groups.reverse();
}

function makeGroup(sessions: CheckpointInfo[]): TaskGroup {
  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  const agentSet = new Set<string>();
  const fileSet = new Set<string>();
  let title = "";
  for (const s of sessions) {
    if (s.agent) agentSet.add(s.agent);
    for (const f of s.filesTouched) fileSet.add(f);
    if (!title && s.title) title = s.title;
  }

  return {
    id: first.sessionId,
    title: title || "(untitled)",
    startAt: first.createdAt,
    endAt: last.createdAt,
    sessions,
    agents: [...agentSet],
    filesTouched: [...fileSet],
  };
}

/** Short agent label for display (e.g., "Claude Code" → "claude"). */
export function shortAgent(agent: string | undefined): string {
  if (!agent) return "";
  if (agent === "Claude Code") return "claude";
  return agent.toLowerCase();
}

/** Format a duration in ms as a compact string (e.g., "45m", "2h 10m"). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "-";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

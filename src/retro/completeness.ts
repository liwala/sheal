import type { Checkpoint } from "@liwala/agent-sessions";

export function assessCompleteness(checkpoint: Checkpoint): string[] {
  const gaps: string[] = [];
  const entries = checkpoint.sessions.flatMap((session) => session.transcript);

  if (checkpoint.sessions.length === 0) {
    gaps.push("No sessions were captured.");
  } else if (entries.length === 0) {
    gaps.push("No transcript entries were captured.");
  }

  if (!entries.some((entry) => entry.type === "assistant")) {
    gaps.push("No assistant messages were captured.");
  }

  if (entries.some((entry) => entry.content.trim().length === 0)) {
    gaps.push("Transcript contains an entry with missing content.");
  }

  const toolCallCount = entries.filter((entry) => entry.type === "tool" && entry.toolName).length;
  const toolResultCount = entries.filter((entry) => entry.type === "tool" && entry.toolOutput !== undefined).length;
  if (toolResultCount > toolCallCount) {
    gaps.push("Transcript contains a tool result without a recorded tool call.");
  }

  const filesTouched = new Set([
    ...checkpoint.root.filesTouched,
    ...checkpoint.sessions.flatMap((session) => session.metadata.filesTouched),
  ]);
  if (filesTouched.size === 0) {
    gaps.push("No filesTouched data was captured.");
  }

  return gaps;
}

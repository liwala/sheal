import type { Checkpoint } from "@liwala/agent-sessions";

const FILE_MODIFYING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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

  // Tool entries may legitimately have empty content (e.g. Gemini tool calls
  // carry the data in toolName/toolOutput); blank content only signals loss
  // on conversational entries.
  if (entries.some((entry) => entry.type !== "tool" && entry.content.trim().length === 0)) {
    gaps.push("Transcript contains an entry with missing content.");
  }

  // Calls and results arrive as separate entries (a single entry carrying
  // both is a self-contained pair). An imbalance in either direction means
  // one side of a pair was lost — a result missing its call, or the common
  // truncation case of a call whose result never landed.
  const pendingCalls = entries.filter(
    (entry) => entry.type === "tool" && entry.toolName !== undefined && entry.toolOutput === undefined,
  ).length;
  const orphanResults = entries.filter(
    (entry) => entry.type === "tool" && entry.toolName === undefined && entry.toolOutput !== undefined,
  ).length;
  if (orphanResults > pendingCalls) {
    gaps.push("Transcript contains a tool result without a recorded tool call.");
  } else if (pendingCalls > orphanResults) {
    gaps.push("Transcript contains a tool call without a recorded result.");
  }

  // Empty filesTouched is only evidence of loss when the transcript shows
  // file-modifying activity; read-only sessions legitimately touch nothing.
  const modifiedFiles = entries.some(
    (entry) => entry.type === "tool" && FILE_MODIFYING_TOOLS.has(entry.toolName ?? ""),
  );
  const filesTouched = new Set([
    ...checkpoint.root.filesTouched,
    ...checkpoint.sessions.flatMap((session) => session.metadata.filesTouched),
  ]);
  if (modifiedFiles && filesTouched.size === 0) {
    gaps.push("No filesTouched data was captured despite file-modifying tool activity.");
  }

  return gaps;
}

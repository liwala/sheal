import type { SessionEntry } from "@liwala/agent-sessions";

export interface DisplayBlock {
  type: "user" | "assistant" | "tool-group" | "system";
  summary: string;
  lines: string[];
  entryCount: number;
}

export const PREVIEW_LINES: Record<DisplayBlock["type"], number> = {
  "user": 3,
  "assistant": 4,
  "tool-group": 0,
  "system": 1,
};

export const TYPE_COLORS: Record<DisplayBlock["type"], string> = {
  "user": "green",
  "assistant": "blue",
  "tool-group": "yellow",
  "system": "gray",
};

export const TYPE_LABELS: Record<DisplayBlock["type"], string> = {
  "user": "USER",
  "assistant": "ASSISTANT",
  "tool-group": "TOOLS",
  "system": "SYSTEM",
};

/**
 * Build display blocks from raw transcript entries.
 * Groups consecutive tool entries, formats text nicely.
 */
export function buildBlocks(entries: SessionEntry[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  let toolGroup: SessionEntry[] = [];

  const flushToolGroup = () => {
    if (toolGroup.length === 0) return;

    const names = toolGroup
      .filter((e) => e.toolName)
      .map((e) => {
        const file = e.filesAffected?.[0]?.split("/").pop() || "";
        return e.toolName + (file ? `(${file})` : "");
      });

    const uniqueNames = [...new Set(names)];
    const summary = uniqueNames.join(", ") || `${toolGroup.length} calls`;

    const lines: string[] = [];
    for (const entry of toolGroup) {
      if (entry.toolName) {
        const file = entry.filesAffected?.[0] || "";
        lines.push(`${entry.toolName} ${file}`);
        if (entry.toolInput && typeof entry.toolInput === "object") {
          const input = entry.toolInput as Record<string, unknown>;
          if (typeof input.command === "string") {
            lines.push(`  $ ${input.command.slice(0, 100)}`);
          } else if (typeof input.pattern === "string") {
            lines.push(`  pattern: ${input.pattern}`);
          } else if (typeof input.content === "string") {
            lines.push(`  (${input.content.length} chars)`);
          }
        }
        if (typeof entry.toolOutput === "string" && entry.toolOutput.length > 0) {
          const preview = entry.toolOutput.replace(/\n/g, " ").slice(0, 100);
          lines.push(`  -> ${preview}`);
        }
      }
    }

    blocks.push({ type: "tool-group", summary, lines, entryCount: toolGroup.length });
    toolGroup = [];
  };

  for (const entry of entries) {
    if (entry.type === "tool") {
      toolGroup.push(entry);
      continue;
    }

    flushToolGroup();

    if (entry.type === "user") {
      if (entry.content.startsWith("Tool:") || entry.content.startsWith("{")) continue;
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 120);
      blocks.push({ type: "user", summary, lines, entryCount: 1 });
    } else if (entry.type === "assistant") {
      const lines = entry.content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 120);
      blocks.push({ type: "assistant", summary, lines, entryCount: 1 });
    } else if (entry.type === "system") {
      const lines = entry.content.split("\n").filter((l) => l.trim()).slice(0, 3);
      if (lines.length === 0) continue;
      const summary = lines[0].slice(0, 80);
      blocks.push({ type: "system", summary, lines, entryCount: 1 });
    }
  }

  flushToolGroup();
  return blocks;
}

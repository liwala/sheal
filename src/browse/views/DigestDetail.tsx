import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { loadDigest } from "../../commands/digest.js";
import type { DigestReport, DigestCategory, DigestItem } from "../../digest/types.js";
import { StatusBar } from "../components/StatusBar.js";

interface DigestDetailProps {
  filename: string;
  onBack: () => void;
  onQuit: () => void;
}

const CATEGORY_COLORS: Record<DigestCategory, string> = {
  SKILLS: "yellow",
  AGENTS: "magenta",
  SCHEDULED_TASKS: "cyan",
  CLAUDE_MD: "green",
};

const CATEGORY_LABELS: Record<DigestCategory, string> = {
  SKILLS: "SKILLS",
  AGENTS: "AGENTS",
  SCHEDULED_TASKS: "SCHEDULED",
  CLAUDE_MD: "CLAUDE.MD",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface DisplayLine {
  type: "header" | "agent" | "item" | "empty";
  text: string;
  color?: string;
  dimColor?: boolean;
}

export function DigestDetail({ filename, onBack, onQuit }: DigestDetailProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 4;

  const report = useMemo(() => loadDigest(filename), [filename]);

  const lines = useMemo(() => {
    if (!report) return [];
    return buildLines(report);
  }, [report]);

  useInput((input, key) => {
    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(Math.max(0, lines.length - maxRows), o + 1));
    }
  });

  if (!report) {
    return (
      <Box flexDirection="column">
        <Text color="red">Could not load digest: {filename}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const windowLines = lines.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      {windowLines.map((line, i) => {
        if (line.type === "empty") return <Text key={i}>{" "}</Text>;
        if (line.type === "header") {
          return <Text key={i} bold color={(line.color || "white") as any}>{line.text}</Text>;
        }
        if (line.type === "agent") {
          return <Text key={i} color={(line.color || "white") as any}>{line.text}</Text>;
        }
        return (
          <Text key={i} dimColor={line.dimColor}>
            {line.text}
          </Text>
        );
      })}

      {lines.length > maxRows && (
        <Text dimColor>
          {scrollOffset > 0 ? "↑ " : "  "}
          Line {scrollOffset + 1}-{Math.min(scrollOffset + maxRows, lines.length)} of {lines.length}
          {scrollOffset + maxRows < lines.length ? " ↓" : ""}
        </Text>
      )}

      <StatusBar
        view="detail"
        searchActive={false}
        info="^/v Scroll  esc Back  q Quit"
      />
    </Box>
  );
}

function buildLines(report: DigestReport): DisplayLine[] {
  const lines: DisplayLine[] = [];

  lines.push({ type: "header", text: `Digest: ${report.window.since.slice(0, 10)} → ${report.window.until.slice(0, 10)}`, color: "white" });
  lines.push({ type: "item", text: `${report.totalSessions} sessions | ${report.totalPrompts} prompts | ${report.scope}`, dimColor: true });
  lines.push({ type: "empty", text: "" });

  // Token summary
  const t = report.tokens;
  lines.push({ type: "header", text: "Token Usage", color: "white" });
  lines.push({ type: "item", text: `  Input: ${formatTokens(t.totalInput)}  Output: ${formatTokens(t.totalOutput)}  Cache: ${formatTokens(t.totalCacheRead)}  API: ${t.totalApiCalls}` });

  for (const [agent, data] of Object.entries(t.byAgent)) {
    lines.push({ type: "agent", text: `  ${agent}: ${formatTokens(data.input + data.output)} tok, ${data.sessionCount}s, ${data.apiCalls} calls`, color: agent === "claude" ? "blue" : agent === "codex" ? "yellow" : agent === "amp" ? "magenta" : "white" });
  }

  lines.push({ type: "empty", text: "" });

  // Top projects
  const topProjects = Object.entries(t.byProject)
    .sort(([, a], [, b]) => (b.input + b.output) - (a.input + a.output))
    .slice(0, 5);
  if (topProjects.length > 0) {
    lines.push({ type: "header", text: "Top Projects", color: "white" });
    for (const [name, data] of topProjects) {
      lines.push({ type: "item", text: `  ${name}: ${formatTokens(data.input + data.output)} (${data.sessionCount}s)` });
    }
    lines.push({ type: "empty", text: "" });
  }

  // Categories
  const cats: DigestCategory[] = ["SKILLS", "AGENTS", "SCHEDULED_TASKS", "CLAUDE_MD"];
  for (const cat of cats) {
    const items = report.categories[cat];
    lines.push({ type: "header", text: `${CATEGORY_LABELS[cat]} (${items.length})`, color: CATEGORY_COLORS[cat] });

    if (items.length === 0) {
      lines.push({ type: "item", text: "  (none)", dimColor: true });
    } else {
      for (const item of items.slice(0, 10)) {
        lines.push({ type: "item", text: `  ${String(item.count).padStart(3)}x  ${item.description.slice(0, 60)}` });
        lines.push({ type: "item", text: `       [${item.agents.join(",")}] ${item.projects.join(", ")}`, dimColor: true });
      }
      if (items.length > 10) {
        lines.push({ type: "item", text: `  ... ${items.length - 10} more`, dimColor: true });
      }
    }
    lines.push({ type: "empty", text: "" });
  }

  // Uncategorized
  if (report.uncategorized.length > 0) {
    lines.push({ type: "header", text: `UNCATEGORIZED (${report.uncategorized.length})`, color: "white" });
    for (const item of report.uncategorized.slice(0, 5)) {
      lines.push({ type: "item", text: `  ${String(item.count).padStart(3)}x  ${item.description.slice(0, 60)}` });
    }
  }

  return lines;
}

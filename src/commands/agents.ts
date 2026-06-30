/**
 * `sheal agents` — aggregate report of how agents (Claude, Codex, Amp, Gemini)
 * are used together across stitched task timelines.
 */
import { stitchSessions, DEFAULT_GAP_MS, formatDuration } from "../browse/utils/stitch.js";
import { gatherSessionsForProject, listAllProjects } from "../agents/gather.js";
import { analyzeAgents } from "../agents/analyze.js";
import type { AgentAnalysis, ProjectTasks } from "../agents/analyze.js";

export interface AgentsOptions {
  project?: string;
  json?: boolean;
  gapHours?: number;
  top?: number;
}

export async function runAgents(opts: AgentsOptions): Promise<void> {
  const gapMs = (opts.gapHours ?? DEFAULT_GAP_MS / (60 * 60 * 1000)) * 60 * 60 * 1000;
  const topN = opts.top ?? 10;

  const projects = listAllProjects();
  const scoped = opts.project
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(opts.project!.toLowerCase()) ||
          p.projectPath.toLowerCase().includes(opts.project!.toLowerCase()),
      )
    : projects;

  if (scoped.length === 0) {
    const msg = opts.project
      ? `No projects match '${opts.project}'.`
      : "No projects found.";
    if (opts.json) console.log(JSON.stringify({ error: msg }));
    else console.error(msg);
    process.exitCode = 1;
    return;
  }

  const projectTasks: ProjectTasks[] = scoped.map((p) => ({
    project: p.name,
    tasks: stitchSessions(gatherSessionsForProject(p.projectPath), gapMs),
  }));

  const analysis = analyzeAgents(projectTasks, topN);

  if (opts.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log(formatReport(analysis, { projectFilter: opts.project, gapMs }));
}

interface FormatOptions {
  projectFilter?: string;
  gapMs: number;
}

function formatReport(a: AgentAnalysis, opts: FormatOptions): string {
  const lines: string[] = [];
  const scope = opts.projectFilter
    ? `project filter: '${opts.projectFilter}' (${a.scope.projects} project${a.scope.projects === 1 ? "" : "s"})`
    : `all projects (${a.scope.projects})`;

  lines.push(`Agent Collaboration Report`);
  lines.push(`==========================`);
  lines.push(`Scope:    ${scope}`);
  lines.push(`Gap:      ${formatDuration(opts.gapMs)}`);
  lines.push(`Tasks:    ${a.tasks.total}  (${a.tasks.multiAgent} multi-agent, ${pct(a.tasks.multiAgent, a.tasks.total)})`);
  lines.push(`Sessions: ${a.sessions.total}`);
  if (!opts.projectFilter) {
    lines.push(`Multi-agent projects: ${a.scope.multiAgentProjects} of ${a.scope.projects}`);
  }
  lines.push("");

  if (a.agentShares.length > 0) {
    lines.push("Agent usage (sessions)");
    for (const s of a.agentShares) {
      lines.push(`  ${s.agent.padEnd(8)} ${String(s.sessions).padStart(5)}  (${s.pct}%)`);
    }
    lines.push("");
  }

  if (a.taskComposition.solo.length > 0 || a.taskComposition.mixed.length > 0) {
    lines.push("Task composition");
    if (a.taskComposition.solo.length > 0) {
      lines.push(`  Solo tasks (${a.tasks.solo})`);
      for (const s of a.taskComposition.solo) {
        lines.push(`    ${s.agent.padEnd(8)} ${String(s.count).padStart(5)}`);
      }
    }
    if (a.taskComposition.mixed.length > 0) {
      lines.push(`  Mixed tasks (${a.tasks.multiAgent})`);
      for (const m of a.taskComposition.mixed) {
        lines.push(`    ${m.combo.padEnd(30)} ${String(m.count).padStart(3)}`);
      }
    }
    lines.push("");
  }

  if (a.handoffs.length > 0) {
    lines.push("Handoffs (A → B, cross-agent only)");
    for (const h of a.handoffs) {
      lines.push(`  ${h.from.padEnd(8)} → ${h.to.padEnd(8)} ${String(h.count).padStart(4)}`);
    }
    lines.push("");
  }

  if (a.opens.length > 0 || a.closes.length > 0) {
    lines.push("Who opens vs. closes a task");
    const rows = Math.max(a.opens.length, a.closes.length);
    lines.push(`  ${"Opens".padEnd(20)} ${"Closes".padEnd(20)}`);
    for (let i = 0; i < rows; i++) {
      const o = a.opens[i];
      const c = a.closes[i];
      const oStr = o ? `${o.agent.padEnd(8)} ${String(o.count).padStart(4)}` : "";
      const cStr = c ? `${c.agent.padEnd(8)} ${String(c.count).padStart(4)}` : "";
      lines.push(`  ${oStr.padEnd(20)} ${cStr.padEnd(20)}`);
    }
    lines.push("");
  }

  if (a.topMixedTasks.length > 0) {
    lines.push(`Top ${a.topMixedTasks.length} multi-agent tasks`);
    for (let i = 0; i < a.topMixedTasks.length; i++) {
      const t = a.topMixedTasks[i];
      const dur = formatDuration(new Date(t.endAt).getTime() - new Date(t.startAt).getTime());
      const title = t.title ? ` — ${truncate(t.title, 60)}` : "";
      lines.push(`  ${pad(i + 1, 2)}. ${t.startAt.slice(0, 16)} ${dur.padEnd(6)} ${t.project.padEnd(30)} [${t.agents.join(",")}] ${t.sessionCount}s${title}`);
    }
  }

  return lines.join("\n");
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "0%";
  return `${Math.round((num / denom) * 100)}%`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * `sheal graph` — Display the cross-session knowledge graph.
 */

import chalk from "chalk";
import { buildKnowledgeGraph, type BuildGraphOptions } from "../graph/builder.js";
import type { KnowledgeGraph } from "../graph/types.js";

export interface GraphOptions {
  projectRoot: string;
  /** Show details for a specific file */
  file?: string;
  /** Show details for a specific agent */
  agent?: string;
  /** Max sessions to analyze */
  limit?: number;
  /** Output as JSON */
  json?: boolean;
}

export function runGraph(options: GraphOptions): void {
  const graph = buildKnowledgeGraph({
    projectRoot: options.projectRoot,
    limit: options.limit,
  });

  if (options.json) {
    // Convert Maps to objects for JSON serialization
    const serializable = {
      ...graph,
      files: Object.fromEntries(graph.files),
      agents: Object.fromEntries(graph.agents),
    };
    console.log(JSON.stringify(serializable, null, 2));
    return;
  }

  if (options.file) {
    printFileDetail(graph, options.file);
  } else if (options.agent) {
    printAgentDetail(graph, options.agent);
  } else {
    printOverview(graph);
  }
}

function printOverview(graph: KnowledgeGraph): void {
  console.log(chalk.bold.magenta("\nCross-Session Knowledge Graph\n"));

  // Stats
  console.log(chalk.bold("Stats"));
  console.log(`  Sessions: ${graph.stats.totalSessions}`);
  console.log(`  Files tracked: ${graph.stats.totalFiles}`);
  console.log(`  Agents: ${graph.stats.totalAgents}`);
  if (graph.stats.dateRange.earliest) {
    console.log(`  Date range: ${graph.stats.dateRange.earliest.split("T")[0]} → ${graph.stats.dateRange.latest.split("T")[0]}`);
  }
  console.log();

  // Agents
  console.log(chalk.bold("Agents"));
  for (const [name, anode] of graph.agents) {
    console.log(`  ${chalk.cyan(name)}: ${anode.sessionCount} sessions, ${anode.files.length} files, ${anode.totalToolCalls} tool calls`);
  }
  console.log();

  // Hot files
  if (graph.hotFiles.length > 0) {
    console.log(chalk.bold("Hot Files") + chalk.gray(" (most modified across sessions)"));
    for (const hf of graph.hotFiles.slice(0, 10)) {
      const shortPath = hf.path.split("/").slice(-2).join("/");
      const agentNote = hf.agentCount > 1 ? chalk.yellow(` (${hf.agentCount} agents)`) : "";
      console.log(`  ${chalk.yellow(String(hf.totalTouches).padStart(3))}x  ${shortPath}${agentNote}`);
    }
    console.log();
  }

  // Correlations
  if (graph.correlations.length > 0) {
    const crossAgent = graph.correlations.filter((c) => c.crossAgent);
    const sameAgent = graph.correlations.filter((c) => !c.crossAgent);

    console.log(chalk.bold("Session Correlations") + chalk.gray(` (${graph.correlations.length} detected)`));

    if (crossAgent.length > 0) {
      console.log(chalk.yellow("  Cross-agent:"));
      for (const c of crossAgent.slice(0, 5)) {
        console.log(`    ${c.description}`);
        const fileList = c.sharedFiles.slice(0, 3).map((f) => f.split("/").pop()).join(", ");
        console.log(chalk.gray(`      Files: ${fileList}${c.sharedFiles.length > 3 ? ` +${c.sharedFiles.length - 3} more` : ""}`));
      }
    }

    if (sameAgent.length > 0) {
      console.log(chalk.gray(`  Same-agent: ${sameAgent.length} overlapping session pairs`));
      for (const c of sameAgent.slice(0, 3)) {
        console.log(`    ${c.description}`);
      }
    }
    console.log();
  }

  // Recent sessions
  console.log(chalk.bold("Recent Sessions"));
  for (const s of graph.sessions.slice(0, 5)) {
    const date = s.date.split("T")[0];
    const fileCount = s.filesTouched.length;
    console.log(`  ${chalk.gray(date)} ${chalk.cyan(s.agent.padEnd(12))} ${s.title.slice(0, 60)}  ${chalk.gray(`(${fileCount} files)`)}`);
  }
  console.log();

  console.log(chalk.gray("Use --file <path> or --agent <name> for details. --json for machine-readable output."));
}

function printFileDetail(graph: KnowledgeGraph, filePath: string): void {
  // Search for matching file (partial match)
  const matches = [...graph.files.entries()].filter(([path]) =>
    path.includes(filePath),
  );

  if (matches.length === 0) {
    console.log(chalk.yellow(`No sessions found touching "${filePath}"`));
    return;
  }

  for (const [path, fnode] of matches) {
    console.log(chalk.bold.magenta(`\nFile: ${path}`));
    console.log(`  Total touches: ${fnode.totalTouches}`);
    console.log(`  Agents: ${fnode.agents.join(", ")}`);
    console.log(`  Sessions: ${fnode.sessions.length}\n`);

    for (const s of fnode.sessions) {
      const date = s.date.split("T")[0];
      console.log(`  ${chalk.gray(date)} ${chalk.cyan(s.agent)} — ${s.touchCount} operations`);
    }
    console.log();
  }
}

function printAgentDetail(graph: KnowledgeGraph, agentName: string): void {
  const match = [...graph.agents.entries()].find(([name]) =>
    name.toLowerCase().includes(agentName.toLowerCase()),
  );

  if (!match) {
    console.log(chalk.yellow(`Agent "${agentName}" not found.`));
    console.log(`Available: ${[...graph.agents.keys()].join(", ")}`);
    return;
  }

  const [name, anode] = match;
  console.log(chalk.bold.magenta(`\nAgent: ${name}`));
  console.log(`  Sessions: ${anode.sessionCount}`);
  console.log(`  Files touched: ${anode.files.length}`);
  console.log(`  Total tool calls: ${anode.totalToolCalls}\n`);

  // Top files by this agent
  const agentFiles = anode.files
    .map((f) => {
      const fnode = graph.files.get(f);
      const agentTouches = fnode?.sessions
        .filter((s) => s.agent === name)
        .reduce((sum, s) => sum + s.touchCount, 0) ?? 0;
      return { path: f, touches: agentTouches };
    })
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 15);

  console.log(chalk.bold("  Top Files"));
  for (const af of agentFiles) {
    const short = af.path.split("/").slice(-2).join("/");
    console.log(`    ${String(af.touches).padStart(3)}x  ${short}`);
  }
  console.log();
}

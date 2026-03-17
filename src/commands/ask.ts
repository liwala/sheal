import chalk from "chalk";
import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "../entire/index.js";
import {
  hasNativeTranscripts,
  listNativeSessions,
  loadNativeSession,
  listAllNativeProjects,
  listNativeSessionsBySlug,
  loadNativeSessionBySlug,
} from "../entire/claude-native.js";
import { detectAgentCli, invokeAgent } from "../retro/agent.js";
import type { Checkpoint, SessionEntry } from "../entire/types.js";

export interface AskOptions {
  question: string;
  projectRoot: string;
  agent?: string;
  limit?: number;
  global?: boolean;
}

/** Max transcript chars to include per session in the analysis prompt */
const EXCERPT_BUDGET = 4_000;
/** Max total chars for all excerpts combined */
const TOTAL_BUDGET = 20_000;

export async function runAsk(options: AskOptions): Promise<void> {
  const { question, projectRoot } = options;
  const limit = options.limit ?? 10;

  // Detect agent CLI early so we fail fast
  const cli = await detectAgentCli(options.agent);
  if (!cli) {
    console.log(chalk.yellow("No compatible agent CLI found."));
    console.log(chalk.gray("Supported: claude, gemini, codex, amp"));
    return;
  }

  // Phase 1: Ask the agent to generate search terms from the question
  console.log(chalk.gray(`Phase 1: Generating search terms (${cli.command})...`));
  const keywords = await generateSearchTerms(cli, question);

  if (keywords.length === 0) {
    console.log(chalk.yellow("Agent could not extract search terms from your question."));
    return;
  }

  console.log(chalk.gray(`Search terms: ${keywords.join(", ")}`));

  // Load all available sessions
  const checkpoints = options.global
    ? loadAllGlobal(limit)
    : await loadAllAvailable(projectRoot, limit);

  if (checkpoints.length === 0) {
    console.log(chalk.yellow("No session data found."));
    console.log(chalk.gray("Supported sources: Entire.io or native Claude Code (~/.claude/projects/)."));
    return;
  }

  // Phase 2: Grep sessions locally for those terms
  console.log(chalk.gray(`Phase 2: Searching ${checkpoints.length} session(s)...`));
  const matches = searchSessions(checkpoints, keywords);

  if (matches.length === 0) {
    console.log(chalk.yellow(`No sessions matched search terms: ${keywords.join(", ")}`));
    return;
  }

  console.log(chalk.gray(`Found ${matches.length} relevant session(s).`));

  // Phase 3: Pass relevant excerpts to the agent for deep analysis
  console.log(chalk.gray(`Phase 3: Analyzing with ${cli.command}...`));
  const prompt = buildAnalysisPrompt(question, matches);
  const result = await invokeAgent(cli, prompt, 180_000);

  if (!result.success) {
    console.log(chalk.red(`Agent analysis failed: ${result.error}`));
    return;
  }

  console.log();
  console.log(result.output);
}

/**
 * Phase 1: Ask the agent to generate precise search terms from a natural language question.
 * This is a quick, focused invocation — we ask for just a comma-separated list.
 */
async function generateSearchTerms(
  cli: Awaited<ReturnType<typeof detectAgentCli>>,
  question: string,
): Promise<string[]> {
  if (!cli) return [];

  const prompt = [
    "You are a search term extractor. Given the user's question about their AI coding sessions,",
    "output ONLY a comma-separated list of specific search terms that would match relevant",
    "session transcripts. Focus on:",
    "- Tool names, library names, project names, CLI commands",
    "- Error messages, file names, technical identifiers",
    "- Domain-specific nouns (not generic English words)",
    "",
    "Do NOT include generic words like 'error', 'problem', 'fix', 'issue', 'session', 'agent'.",
    "Do NOT include any explanation — ONLY the comma-separated terms.",
    "",
    `Question: ${question}`,
    "",
    "Search terms:",
  ].join("\n");

  const result = await invokeAgent(cli, prompt, 30_000);

  if (!result.success || !result.output) return [];

  // Parse comma-separated response
  return result.output
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && !t.includes("search terms"));
}

interface SessionMatch {
  checkpointId: string;
  sessionId: string;
  createdAt: string;
  agent?: string;
  projectName?: string;
  score: number;
  excerpts: string[];
}

/**
 * Load all available checkpoints/sessions (Entire.io + native).
 */
async function loadAllAvailable(projectRoot: string, limit: number): Promise<Checkpoint[]> {
  const checkpoints: Checkpoint[] = [];

  // Entire.io
  const hasBranch = await hasEntireBranch(projectRoot);
  if (hasBranch) {
    const infos = await listCheckpoints(projectRoot);
    for (const info of infos.slice(0, limit)) {
      try {
        const cp = await loadCheckpoint(projectRoot, info.checkpointId);
        if (cp && cp.sessions.length > 0) checkpoints.push(cp);
      } catch {
        // skip unreadable checkpoints
      }
    }
  }

  // Native Claude Code transcripts
  if (hasNativeTranscripts(projectRoot)) {
    const sessions = listNativeSessions(projectRoot);
    for (const info of sessions.slice(0, limit)) {
      try {
        const cp = loadNativeSession(projectRoot, info.sessionId);
        if (cp && cp.sessions.length > 0) checkpoints.push(cp);
      } catch {
        // skip unreadable sessions
      }
    }
  }

  return checkpoints;
}

/**
 * Load sessions from ALL Claude Code projects (~/.claude/projects/).
 * Distributes the limit across projects, prioritizing most recently active.
 */
function loadAllGlobal(limit: number): Checkpoint[] {
  const projects = listAllNativeProjects();
  const checkpoints: Checkpoint[] = [];

  // Load up to `limit` sessions total, spread across projects (most recent first)
  const perProject = Math.max(3, Math.ceil(limit / Math.max(projects.length, 1)));

  for (const project of projects) {
    if (checkpoints.length >= limit) break;

    const sessions = listNativeSessionsBySlug(project.slug);
    const remaining = limit - checkpoints.length;
    const toLoad = Math.min(sessions.length, perProject, remaining);

    for (const info of sessions.slice(0, toLoad)) {
      try {
        const cp = loadNativeSessionBySlug(project.slug, info.sessionId);
        if (cp && cp.sessions.length > 0) {
          // Tag sessions with the project name for context in the prompt
          for (const s of cp.sessions) {
            (s.metadata as unknown as Record<string, unknown>).projectName = project.name;
            (s.metadata as unknown as Record<string, unknown>).projectPath = project.projectPath;
          }
          checkpoints.push(cp);
        }
      } catch {
        // skip
      }
    }
  }

  return checkpoints;
}

/**
 * Phase 2: Search sessions for keyword matches and return ranked results with excerpts.
 * Uses word-boundary matching to avoid false positives (e.g. "bd" matching "embedded").
 */
function searchSessions(checkpoints: Checkpoint[], keywords: string[]): SessionMatch[] {
  const matches: SessionMatch[] = [];

  // Build word-boundary regexes for each keyword
  const patterns = keywords.map((kw) => {
    // Escape regex special chars, then wrap in word boundaries
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "gi");
  });

  for (const cp of checkpoints) {
    for (const session of cp.sessions) {
      let score = 0;
      const excerpts: string[] = [];

      for (const entry of session.transcript) {
        if (entry.type === "tool") continue;

        const text = entry.content;
        let entryHits = 0;

        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          const m = text.match(pattern);
          if (m) entryHits += m.length;
        }

        if (entryHits > 0) {
          score += entryHits;
          const excerpt = truncateExcerpt(entry, keywords);
          if (excerpt) excerpts.push(excerpt);
        }
      }

      if (score > 0) {
        const meta = session.metadata as unknown as Record<string, unknown>;
        matches.push({
          checkpointId: cp.root.checkpointId,
          sessionId: session.metadata.sessionId,
          createdAt: session.metadata.createdAt,
          agent: session.metadata.agent,
          projectName: meta.projectName as string | undefined,
          score,
          excerpts: excerpts.slice(0, 10),
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/**
 * Truncate an entry to a reasonable excerpt around the first keyword match.
 */
function truncateExcerpt(entry: SessionEntry, keywords: string[]): string | null {
  const content = entry.content;
  if (content.length < 20) return null;

  const prefix = entry.type === "user" ? "USER: " : "ASSISTANT: ";

  if (content.length <= EXCERPT_BUDGET) {
    return prefix + content;
  }

  const lower = content.toLowerCase();
  let bestPos = -1;

  for (const kw of keywords) {
    const pos = lower.indexOf(kw.toLowerCase());
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) return null;

  const start = Math.max(0, bestPos - 500);
  const end = Math.min(content.length, bestPos + EXCERPT_BUDGET - 500);
  const slice = content.slice(start, end);

  return prefix + (start > 0 ? "..." : "") + slice + (end < content.length ? "..." : "");
}

/**
 * Phase 3: Build the analysis prompt with the question and relevant session excerpts.
 */
function buildAnalysisPrompt(question: string, matches: SessionMatch[]): string {
  const parts: string[] = [];

  parts.push("You are analyzing AI coding session transcripts to answer a user's question.");
  parts.push("Below are relevant excerpts from sessions that matched search terms derived from the question.");
  parts.push("");
  parts.push(`**User's question:** ${question}`);
  parts.push("");

  let totalChars = 0;

  for (const match of matches) {
    if (totalChars > TOTAL_BUDGET) {
      parts.push(`(${matches.length - matches.indexOf(match)} more sessions omitted for brevity)`);
      break;
    }

    parts.push(`---`);
    const projectLabel = match.projectName ? `[${match.projectName}] ` : "";
    parts.push(`**${projectLabel}Session ${match.sessionId.slice(0, 12)}** (${match.createdAt?.slice(0, 16) || "unknown date"}, ${match.agent || "unknown agent"}, relevance: ${match.score} hits)`);
    parts.push("");

    for (const excerpt of match.excerpts) {
      if (totalChars + excerpt.length > TOTAL_BUDGET) break;
      parts.push(excerpt);
      parts.push("");
      totalChars += excerpt.length;
    }
  }

  parts.push("---");
  parts.push("");
  parts.push("**Instructions:**");
  parts.push("1. Answer the user's question based on the session excerpts above");
  parts.push("2. Identify patterns across sessions if multiple are relevant");
  parts.push("3. Be specific — cite session IDs, error messages, or file names when possible");
  parts.push("4. If the excerpts don't contain enough info to fully answer, say so");
  parts.push("5. Keep your answer concise and actionable (under 500 words)");

  return parts.join("\n");
}

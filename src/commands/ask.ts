import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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

  const cli = await detectAgentCli(options.agent);

  // Phase 1: Extract search terms (agent with local fallback)
  const agentLabel = cli ? cli.command : "local";
  console.log(chalk.gray(`Phase 1: Generating search terms (${agentLabel})...`));
  const keywords = await generateSearchTerms(cli, question);

  if (keywords.length === 0) {
    console.log(chalk.yellow("Could not extract search terms from your question."));
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

  // Phase 3: Try agent analysis, fall back to showing excerpts directly
  let answer: string;
  if (cli) {
    console.log(chalk.gray(`Phase 3: Analyzing with ${cli.command}...`));
    const prompt = buildAnalysisPrompt(question, matches, options.global);
    const result = await invokeAgent(cli, prompt, 180_000);

    if (result.success && result.output) {
      answer = result.output;
    } else {
      console.log(chalk.yellow(`Agent analysis unavailable (${result.error ?? "empty output"}), showing raw excerpts.`));
      answer = formatExcerptsAsAnswer(question, matches);
    }
  } else {
    console.log(chalk.gray("Phase 3: No agent available, showing raw excerpts."));
    answer = formatExcerptsAsAnswer(question, matches);
  }

  console.log();
  console.log(answer);

  // Save the ask result
  const saveDir = options.global
    ? join(homedir(), ".sheal", "asks")
    : join(projectRoot, ".sheal", "asks");
  const savedPath = saveAskResult(saveDir, {
    question,
    searchTerms: keywords,
    matches,
    answer,
    agent: agentLabel,
    global: !!options.global,
  });
  console.log(chalk.gray(`\nSaved to ${savedPath}`));
}

/** Common stop words to exclude from local keyword extraction */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "was", "were", "are", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "about", "up", "down", "and", "but", "or", "if", "while", "that",
  "what", "which", "who", "whom", "this", "these", "those", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their",
  // Generic words unhelpful for session search
  "error", "errors", "problem", "problems", "fix", "fixes", "fixed",
  "issue", "issues", "session", "sessions", "agent", "agents", "main",
  "work", "working", "worked", "works", "use", "using", "used", "make", "made",
  "get", "got", "set", "try", "tried", "thing", "things", "way", "ways",
  "project", "projects", "code", "file", "files", "like", "want", "know",
  "bad", "good", "big", "small", "new", "old", "first", "last",
  "happen", "happened", "happening", "change", "changed", "changes",
]);

/**
 * Extract search keywords locally from the question text.
 * Pulls out non-stopword tokens, keeping technical-looking terms.
 */
function extractKeywordsLocally(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Phase 1: Generate search terms from a natural language question.
 * Tries the agent first; falls back to local keyword extraction.
 */
async function generateSearchTerms(
  cli: Awaited<ReturnType<typeof detectAgentCli>>,
  question: string,
): Promise<string[]> {
  if (!cli) return extractKeywordsLocally(question);

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

  if (result.success && result.output) {
    const terms = result.output
      .split(/[,\n]/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 1 && !t.includes("search terms"));
    if (terms.length > 0) return terms;
  }

  // Fallback: extract keywords locally
  if (process.env.SHEAL_DEBUG) {
    console.error("[generateSearchTerms] Agent returned no terms, falling back to local extraction");
  }
  return extractKeywordsLocally(question);
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
 * Save an ask result as a markdown file with frontmatter.
 */
function saveAskResult(
  dir: string,
  data: {
    question: string;
    searchTerms: string[];
    matches: SessionMatch[];
    answer: string;
    agent: string;
    global: boolean;
  },
): string {
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const slug = data.question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const filename = `${timestamp}-${slug}.md`;

  const sessionRefs = data.matches
    .slice(0, 10)
    .map((m) => {
      const project = m.projectName ? `[${m.projectName}] ` : "";
      return `- ${project}${m.sessionId.slice(0, 12)} (${m.createdAt?.slice(0, 10) || "?"}, ${m.score} hits)`;
    })
    .join("\n");

  const content = `---
question: ${data.question}
date: ${date}
search_terms: [${data.searchTerms.join(", ")}]
sessions_matched: ${data.matches.length}
agent: ${data.agent}
scope: ${data.global ? "global" : "project"}
---

## Answer

${data.answer}

## Sessions Referenced

${sessionRefs}
`;

  const path = join(dir, filename);
  writeFileSync(path, content, "utf-8");
  return path;
}

/**
 * Format matched excerpts directly when no agent is available for analysis.
 */
function formatExcerptsAsAnswer(question: string, matches: SessionMatch[]): string {
  const parts: string[] = [];
  parts.push(`## Excerpts matching: ${question}`);
  parts.push("");

  let totalChars = 0;
  for (const match of matches) {
    if (totalChars > TOTAL_BUDGET) break;
    const projectLabel = match.projectName ? `[${match.projectName}] ` : "";
    parts.push(`### ${projectLabel}Session ${match.sessionId.slice(0, 12)} (${match.createdAt?.slice(0, 16) || "?"}, ${match.score} hits)`);
    parts.push("");
    for (const excerpt of match.excerpts) {
      if (totalChars + excerpt.length > TOTAL_BUDGET) break;
      parts.push(excerpt);
      parts.push("");
      totalChars += excerpt.length;
    }
  }

  return parts.join("\n");
}

/**
 * Phase 3: Build the analysis prompt with the question and relevant session excerpts.
 */
function buildAnalysisPrompt(question: string, matches: SessionMatch[], global?: boolean): string {
  const parts: string[] = [];

  parts.push("You are analyzing AI coding session transcripts to answer a user's question.");
  if (global) {
    const projectNames = [...new Set(matches.map((m) => m.projectName).filter(Boolean))];
    parts.push(`These excerpts come from ${projectNames.length} different project(s): ${projectNames.join(", ")}.`);
    parts.push("Treat each project as a separate codebase. Do not assume shared context between projects.");
  }
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

/**
 * List previously saved ask results.
 */
export function runAskList(options: { projectRoot: string; global?: boolean }): void {
  const dir = options.global
    ? join(homedir(), ".sheal", "asks")
    : join(options.projectRoot, ".sheal", "asks");

  if (!existsSync(dir)) {
    console.log(chalk.yellow("No saved ask results found."));
    return;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse();
  if (files.length === 0) {
    console.log(chalk.yellow("No saved ask results found."));
    return;
  }

  console.log(chalk.bold(`${files.length} saved ask result(s)`));
  console.log(chalk.gray("─".repeat(50)));

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const questionMatch = content.match(/^question:\s*(.+)/m);
      const dateMatch = content.match(/^date:\s*(.+)/m);
      const question = questionMatch?.[1] || file;
      const date = dateMatch?.[1] || "";
      console.log(`  ${chalk.gray(date)}  ${chalk.cyan(question)}`);
      console.log(chalk.gray(`    ${file}`));
    } catch {
      console.log(`  ${chalk.gray(file)}`);
    }
  }

  // Hint about global asks when viewing project-scoped results
  if (!options.global) {
    const globalDir = join(homedir(), ".sheal", "asks");
    if (existsSync(globalDir)) {
      const globalCount = readdirSync(globalDir).filter((f) => f.endsWith(".md")).length;
      if (globalCount > 0) {
        console.log(chalk.gray(`\n${globalCount} global ask(s) also available (sheal ask-list --global)`));
      }
    }
  }
}

/**
 * Show a specific saved ask result by filename or search term.
 */
export function runAskShow(options: { projectRoot: string; query: string; global?: boolean }): void {
  const dir = options.global
    ? join(homedir(), ".sheal", "asks")
    : join(options.projectRoot, ".sheal", "asks");

  if (!existsSync(dir)) {
    console.log(chalk.yellow("No saved ask results found."));
    return;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse();
  const q = options.query.toLowerCase();

  // Match by filename substring or question content
  const match = files.find((f) => {
    if (f.toLowerCase().includes(q)) return true;
    try {
      const content = readFileSync(join(dir, f), "utf-8");
      const questionMatch = content.match(/^question:\s*(.+)/m);
      return questionMatch?.[1]?.toLowerCase().includes(q);
    } catch {
      return false;
    }
  });

  if (!match) {
    console.log(chalk.yellow(`No ask result matching "${options.query}"`));
    return;
  }

  const content = readFileSync(join(dir, match), "utf-8");
  console.log(content);
}

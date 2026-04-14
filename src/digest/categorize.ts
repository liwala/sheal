/**
 * Categorize user prompts into SKILLS, AGENTS, SCHEDULED_TASKS, CLAUDE_MD.
 *
 * Uses pattern matching with priority ordering.
 * Filters noise, deduplicates similar prompts by normalized prefix.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DigestCategory, DigestItem, RawPrompt } from "./types.js";

interface CategoryRule {
  category: DigestCategory;
  patterns: RegExp[];
}

/**
 * Noise patterns — prompts matching these are dropped entirely.
 */
const NOISE_PATTERNS: RegExp[] = [
  /^\[Image: source:/,
  /^\[Request interrupted/,
  /^<command-message>/,
  /^<task-notification>/,
  /^<system-reminder>/,
  /^<environment/,
  /^<permissions/,
  /^<INSTRUCTIONS/,
  /^<!--/,
  /^#\s+(AGENTS|CLAUDE|Repository)\b/,
  /^#\s+\/\w+\s+—/,              // Skill help headers: "# /loop — ..."
  /^#\s+(Add|List|Remove|View|Run)\s+Scheduled/i,  // Scheduler help text
  /^You are a\b/,
  /^Base directory for this skill:/,
  /^Usage:\s+\//,
  /^Date:\s+\w{3}\s+\d/,
  /^Caveat:\s+The messages below/,
  /^Reply with just the number/,    // Test prompts
  /^This session is being continued/,  // Session continuation boilerplate
  /^-$/,                              // Single dash (empty stdin)
];

/**
 * Check if a prompt is noise (system-injected, tool output, or not a real user prompt).
 */
function isNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 10) return true;
  for (const p of NOISE_PATTERNS) {
    if (p.test(trimmed)) return true;
  }
  // Very long single-line text is usually injected context
  if (trimmed.length > 500 && !trimmed.includes("\n")) return true;
  return false;
}

/**
 * Clean a description for display — strip XML tags, trim.
 */
function cleanDescription(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

const RULES: CategoryRule[] = [
  {
    category: "SCHEDULED_TASKS",
    patterns: [
      /\bschedul(e|ed|ing|er)\b/i,
      /\bcron\b/i,
      /\blaunchd\b/i,
      /\bevery\s+(day|week|month|hour|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(at|run|check|do|send|scan)\b/i,
      /\b(daily|weekly|monthly)\s+(at|digest|report|check|run)\b/i,
      /\brecurring\s+(task|job|prompt|run|check)\b/i,
      /\/scheduler/i,
      /\b(set up|create|add)\b.*\b(cron|schedule|timer|launchd)\b/i,
      /\bfollow these steps exactly\b/i,  // Recurring loop prompts pattern
      /\bscan\s+(latest|new|recent)\b/i,  // Scanning/monitoring patterns
      /^check\s+(slack|gmail|email|the\s+followup|my\s+gmail|my\s+email|my\s+slack)/i,  // Monitoring checks
      /\bcheck\s+.*\bfor\s+new\s+(message|email|notification)/i,
      /\bcheck\s+.*\btracker\b/i,
      /\bpull\s+(new|latest|recent)\b/i,
    ],
  },
  {
    category: "SKILLS",
    patterns: [
      /\/retro\b/i,
      /\/commit\b/i,
      /\/review/i,
      /\/plan\b/i,
      /\/init\b/i,
      /\/browse\b/i,
      /\/ask\b/i,
      /\/simplify\b/i,
      /\/loop\b/i,
      /\/infographic/i,
      /\/linkedin/i,
      /\/cockpit/i,
      /\/lead-magnet/i,
      /\/landing-page/i,
      /\/meeting-to-html/i,
      /\/clay/i,
      /\/outreach/i,
      /\/yt-to-content/i,
      /\/ultra-think/i,
      /\/digest\b/i,
      /\bslash\s+command\b/i,
      /\bskill\b.*\b(create|build|make|write|install)\b/i,
      /\b(create|build|make|write|install)\b.*\bskill\b/i,
      /\binfographic\b/i,
      /\blead\s*magnet\b/i,
      /\blinkedin\s+(post|hook|content|series|carousel)\b/i,
      /\bdashboard\b/i,
      /\blanding\s+page\b/i,
      /\b(write|draft|create)\s+(a\s+)?(post|hook|dm|message|outreach)\b/i,
    ],
  },
  {
    category: "AGENTS",
    patterns: [
      /\bagent\b/i,
      /\bsub-?agent\b/i,
      /\borchestrat/i,
      /\bmulti-?agent\b/i,
      /\bswarm\b/i,
      /\bspawn\b/i,
      /\bdelegate\b/i,
      /\bautonomous\b/i,
      /\b(research|scrape|crawl|enrich|prospect)\b.*\b(and|then|for|the|this|a)\b/i,
      /\bpipeline\b/i,
      /\bworkflow\b/i,
      /\bMCP\b/,
      /\btool\s+(use|call|integration)\b/i,
    ],
  },
  {
    category: "CLAUDE_MD",
    patterns: [
      /\bCLAUDE\.md\b/i,
      /\bAGENTS\.md\b/i,
      /\b\.cursorrules\b/i,
      /\bCODEX\.md\b/i,
      /\binstruction(s)?\b.*\b(file|add|update|change)\b/i,
      /\bremember\b.*\b(from now|always|every|when|this|that)\b/i,
      /\bfrom now on\b/i,
      /\balways\s+(use|do|run|check|include|add|start)\b/i,
      /\bwhenever\s+(you|i|we)\b/i,
      /\bproject\s+rules?\b/i,
      /\bpreference/i,
      /\bsettings\.json\b/i,
      /\bhook(s)?\s+(add|create|config|setup|when)\b/i,
      /\bdon'?t\s+(ever|always|never)\b/i,
      /\bnever\s+(do|use|run|add|create)\b/i,
      /\bstop\s+(doing|adding|using)\b/i,
      /\bformat(ting)?\s+(rule|style|always)\b/i,
    ],
  },
];

/**
 * Categorize a single prompt. Returns null if no category matches.
 */
function categorize(text: string): DigestCategory | null {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return rule.category;
      }
    }
  }
  return null;
}

/**
 * Normalize a prompt for dedup grouping.
 * Lowercase, trim, collapse whitespace, strip XML, take first 80 chars.
 */
function normalize(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Categorize and deduplicate a list of raw prompts.
 */
export function categorizePrompts(prompts: RawPrompt[]): {
  categories: Record<DigestCategory, DigestItem[]>;
  uncategorized: DigestItem[];
} {
  const groups = new Map<string, {
    description: string;
    category: DigestCategory | null;
    sessionIds: Set<string>;
    projects: Set<string>;
    agents: Set<string>;
    count: number;
    lastSeen: string;
  }>();

  for (const p of prompts) {
    // Skip noise
    if (isNoise(p.text)) continue;

    const key = normalize(p.text);
    if (!key || key.length < 5) continue;

    const category = categorize(p.text);

    if (!groups.has(key)) {
      groups.set(key, {
        description: cleanDescription(p.text.split("\n")[0]),
        category,
        sessionIds: new Set(),
        projects: new Set(),
        agents: new Set(),
        count: 0,
        lastSeen: p.timestamp,
      });
    }

    const group = groups.get(key)!;
    group.sessionIds.add(p.sessionId);
    group.projects.add(p.project);
    group.agents.add(p.agent);
    group.count++;
    if (p.timestamp > group.lastSeen) group.lastSeen = p.timestamp;
    // If this occurrence matches a category but previous didn't, upgrade
    if (!group.category && category) group.category = category;
  }

  const categories: Record<DigestCategory, DigestItem[]> = {
    SKILLS: [],
    AGENTS: [],
    SCHEDULED_TASKS: [],
    CLAUDE_MD: [],
  };
  const uncategorized: DigestItem[] = [];

  for (const [, group] of groups) {
    const item: DigestItem = {
      description: group.description,
      sessionIds: [...group.sessionIds],
      projects: [...group.projects],
      agents: [...group.agents],
      count: group.count,
      category: group.category || "SKILLS",
      lastSeen: group.lastSeen,
    };

    if (group.category) {
      categories[group.category].push(item);
    } else {
      uncategorized.push(item);
    }
  }

  // Sort each category by frequency descending
  for (const cat of Object.values(categories)) {
    cat.sort((a, b) => b.count - a.count);
  }
  uncategorized.sort((a, b) => b.count - a.count);

  return { categories, uncategorized };
}

/**
 * Build the LLM prompt for Haiku categorization.
 */
function buildCategorizationPrompt(items: Array<{ id: number; description: string; count: number }>): string {
  const itemLines = items.map((i) => `${i.id}|${i.count}x|${i.description}`).join("\n");

  return `You are categorizing user prompts from AI coding sessions into exactly 4 categories.

CATEGORIES:
- SKILLS: Repeatable creative tasks triggered manually (writing posts, creating infographics, building dashboards, drafting outreach, content creation)
- AGENTS: Autonomous research or action workflows (enriching data, scraping, crawling, researching prospects, checking emails, multi-step pipelines)
- SCHEDULED_TASKS: Recurring things that should be automated (daily checks, weekly reports, monitoring, periodic scans, loop-based tasks, anything that runs repeatedly)
- CLAUDE_MD: Repeated preferences or context to bake into instructions (formatting rules, behavior corrections, "always do X", "never do Y", tool preferences)

PROMPTS TO CATEGORIZE:
${itemLines}

RULES:
- Output ONLY lines in format: ID|CATEGORY
- One line per prompt, no explanation
- If a prompt doesn't fit any category, output: ID|NONE
- High-frequency prompts (5x+) that aren't slash commands are likely SCHEDULED_TASKS
- Prompts about formatting, preferences, or corrections are CLAUDE_MD
- Prompts asking to "check", "scan", "monitor", "pull" regularly are SCHEDULED_TASKS
- Prompts about creating content, writing posts, building pages are SKILLS

OUTPUT:`;
}

/**
 * Extract assistant text from a Claude Code session JSONL file.
 */
function extractAssistantText(sessionId: string): string | null {
  // Validate session ID format to prevent path traversal
  // Session IDs are UUIDs (hex + dashes), reject anything else
  if (!/^[a-f0-9-]+$/i.test(sessionId)) return null;

  // Search all project dirs for this session
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return null;

  for (const slug of readdirSync(projectsDir)) {
    const jsonlPath = join(projectsDir, slug, `${sessionId}.jsonl`);
    if (!existsSync(jsonlPath)) continue;

    const content = readFileSync(jsonlPath, "utf-8");
    const texts: string[] = [];

    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant" && obj.message?.content) {
          const blocks = Array.isArray(obj.message.content) ? obj.message.content : [obj.message.content];
          for (const block of blocks) {
            if (typeof block === "string") texts.push(block);
            else if (block.type === "text" && block.text) texts.push(block.text);
          }
        }
      } catch { /* skip */ }
    }

    if (texts.length > 0) return texts.join("\n");
  }
  return null;
}

/**
 * Invoke Haiku for smart categorization.
 *
 * Uses claude -p with JSON output, then reads the actual response from
 * the session JSONL (workaround: claude -p returns empty result field
 * when invoked inside a parent Claude Code session).
 */
async function invokeHaiku(prompt: string, timeoutMs = 60_000): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "-", "--output-format", "json", "--model", "haiku"], {
      timeout: timeoutMs,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));

    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) { resolve(null); return; }

      const raw = Buffer.concat(stdout).toString().trim();

      // Try to parse JSON and get session_id
      try {
        const json = JSON.parse(raw);

        // If result has text, use it directly
        if (json.result && json.result.length > 0) {
          resolve(json.result);
          return;
        }

        // Workaround: read response from session JSONL
        if (json.session_id) {
          const text = extractAssistantText(json.session_id);
          if (text) {
            resolve(text);
            return;
          }
        }
      } catch {
        // Not JSON — might be plain text
        if (raw.length > 0) {
          resolve(raw);
          return;
        }
      }

      resolve(null);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * LLM-enriched categorization using Haiku.
 * Only enriches UNCATEGORIZED items — regex matches are trusted.
 * This prevents the LLM from downgrading correct regex categorizations.
 * Processes in batches to stay within token limits.
 */
export async function enrichWithLLM(
  regexResult: { categories: Record<DigestCategory, DigestItem[]>; uncategorized: DigestItem[] },
): Promise<{ categories: Record<DigestCategory, DigestItem[]>; uncategorized: DigestItem[] }> {
  const allCats: DigestCategory[] = ["SKILLS", "AGENTS", "SCHEDULED_TASKS", "CLAUDE_MD"];

  // Only send uncategorized items to the LLM — regex matches are already correct
  const toEnrich: Array<{ id: number; item: DigestItem }> = [];
  let id = 0;
  for (const item of regexResult.uncategorized) {
    toEnrich.push({ id: id++, item });
  }

  if (toEnrich.length === 0) return regexResult;

  // Process in batches of 50 to stay within token limits
  const BATCH_SIZE = 50;
  const llmCategories = new Map<number, DigestCategory | null>();

  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + BATCH_SIZE);
    const promptItems = batch.map((b) => ({
      id: b.id,
      description: b.item.description.slice(0, 80),
      count: b.item.count,
    }));

    const prompt = buildCategorizationPrompt(promptItems);
    const result = await invokeHaiku(prompt);

    if (!result) {
      // LLM failed for this batch — items stay uncategorized
      continue;
    }

    // Parse LLM output: "ID|CATEGORY" per line
    for (const line of result.split("\n")) {
      const match = line.trim().match(/^(\d+)\|(\w+)/);
      if (!match) continue;
      const itemId = parseInt(match[1], 10);
      const cat = match[2] as string;

      if (allCats.includes(cat as DigestCategory)) {
        llmCategories.set(itemId, cat as DigestCategory);
      }
      // NONE or unrecognized → stays uncategorized (no action needed)
    }
  }

  // Start with existing regex categories (preserved as-is)
  const categories: Record<DigestCategory, DigestItem[]> = {
    SKILLS: [...regexResult.categories.SKILLS],
    AGENTS: [...regexResult.categories.AGENTS],
    SCHEDULED_TASKS: [...regexResult.categories.SCHEDULED_TASKS],
    CLAUDE_MD: [...regexResult.categories.CLAUDE_MD],
  };
  const uncategorized: DigestItem[] = [];

  // Apply LLM enrichment to previously-uncategorized items
  for (const { id: itemId, item } of toEnrich) {
    const llmCat = llmCategories.get(itemId);
    if (llmCat) {
      item.category = llmCat;
      categories[llmCat].push(item);
    } else {
      uncategorized.push(item);
    }
  }

  // Sort each category by frequency
  for (const cat of Object.values(categories)) {
    cat.sort((a, b) => b.count - a.count);
  }
  uncategorized.sort((a, b) => b.count - a.count);

  return { categories, uncategorized };
}

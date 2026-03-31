/**
 * Categorize user prompts into SKILLS, AGENTS, SCHEDULED_TASKS, CLAUDE_MD.
 *
 * Uses pattern matching with priority ordering.
 * Filters noise, deduplicates similar prompts by normalized prefix.
 */

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

import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGlobalDir, getProjectDir, listLearnings } from "../learn/index.js";
import { detectProjectTags } from "../learn/detect.js";
import type { LearningFile } from "../learn/types.js";

export interface RulesOptions {
  projectRoot: string;
  dryRun: boolean;
}

const RULES_BEGIN = "<!-- BEGIN SHEAL RULES -->";
const RULES_END = "<!-- END SHEAL RULES -->";

/** Agent instruction files we know how to inject into, in priority order. */
const AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  "CODEX.md",
  ".github/copilot-instructions.md",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Load and deduplicate active learnings from project + global sources.
 * Project learnings take precedence over global ones with the same ID.
 */
function loadActiveLearnings(projectRoot: string): LearningFile[] {
  const projectDir = getProjectDir(projectRoot);
  const globalDir = getGlobalDir();
  const projectTags = detectProjectTags(projectRoot);

  const projectLearnings = existsSync(projectDir) ? listLearnings(projectDir) : [];
  const globalLearnings = listLearnings(globalDir);

  const result: LearningFile[] = [];
  const seenIds = new Set<string>();

  // Project learnings first (take precedence)
  for (const l of projectLearnings) {
    if (l.status !== "active") continue;
    seenIds.add(l.id);
    result.push(l);
  }

  // Global learnings — only if tag-relevant and not already present
  for (const l of globalLearnings) {
    if (l.status !== "active") continue;
    if (seenIds.has(l.id)) continue;
    if (!l.tags.some((t) => projectTags.includes(t))) continue;
    result.push(l);
  }

  return result;
}

/** Tags to skip when choosing a grouping key (platform/language tags, not topics). */
const GENERIC_TAGS = new Set([
  "general", "workflow", "environment",
  "claude", "cursor", "codex", "copilot", "amp", "gemini",
  "javascript", "typescript", "node", "react", "go", "python", "rust",
]);

/**
 * Pick the best tag to group a learning under.
 * Prefers the first non-generic tag; falls back to "General".
 */
function groupKey(learning: LearningFile): string {
  const tag = learning.tags.find((t) => !GENERIC_TAGS.has(t));
  return tag ?? "General";
}

/** Capitalize first letter of a tag for use as a section header. */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Get the first sentence of the body as a concise rule line.
 * Falls back to title if body is empty.
 */
function ruleLine(learning: LearningFile): string {
  const first = learning.body.split(/(?<=\.)\s/)[0];
  const text = (first ?? learning.title).trim();
  return `- [${learning.id}] ${text}`;
}

/**
 * Generate the rules block grouped by tag with ID references.
 */
function generateRulesBlock(learnings: LearningFile[]): string {
  // Group learnings by their primary tag
  const groups = new Map<string, LearningFile[]>();
  for (const l of learnings) {
    const key = groupKey(l);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  const sections: string[] = [];
  for (const [tag, items] of groups) {
    sections.push(`### ${titleCase(tag)}\n${items.map(ruleLine).join("\n")}`);
  }

  return [
    RULES_BEGIN,
    "## Session Learnings",
    "<!-- Run `sheal learn show <id>` for full context on any rule -->",
    "",
    sections.join("\n\n"),
    RULES_END,
  ].join("\n");
}

/**
 * Inject or update the rules block in a file.
 * Returns true if the file was modified.
 */
function injectRulesBlock(filepath: string, block: string, dryRun: boolean): boolean {
  const content = readFileSync(filepath, "utf-8");

  if (content.includes(RULES_BEGIN)) {
    const re = new RegExp(
      `${escapeRegExp(RULES_BEGIN)}[\\s\\S]*?${escapeRegExp(RULES_END)}`,
    );
    const updated = content.replace(re, block);
    if (updated === content) return false;
    if (!dryRun) writeFileSync(filepath, updated);
    return true;
  }

  // Append to end of file
  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  const updated = content + separator + block + "\n";
  if (!dryRun) writeFileSync(filepath, updated);
  return true;
}

/**
 * Remove the rules block from a file.
 * Returns true if the file was modified.
 */
function removeRulesBlock(filepath: string, dryRun: boolean): boolean {
  const content = readFileSync(filepath, "utf-8");
  if (!content.includes(RULES_BEGIN)) return false;

  const re = new RegExp(
    `\\n?${escapeRegExp(RULES_BEGIN)}[\\s\\S]*?${escapeRegExp(RULES_END)}\\n?`,
  );
  const updated = content.replace(re, "\n");
  if (updated === content) return false;
  if (!dryRun) writeFileSync(filepath, updated);
  return true;
}

export async function runRules(options: RulesOptions): Promise<void> {
  const { projectRoot, dryRun } = options;
  const prefix = dryRun ? "[dry-run] " : "";

  const learnings = loadActiveLearnings(projectRoot);

  // Find existing agent config files
  const existing = AGENT_FILES.filter((f) =>
    existsSync(join(projectRoot, f)),
  );

  if (learnings.length === 0) {
    console.log(chalk.yellow("No active learnings to inject."));

    // Clean up any existing rules blocks
    for (const file of existing) {
      const filepath = join(projectRoot, file);
      if (removeRulesBlock(filepath, dryRun)) {
        console.log(`${prefix}Removed stale rules block from ${file}`);
      }
    }
    return;
  }

  const block = generateRulesBlock(learnings);

  console.log(chalk.gray(`${prefix}Injecting ${learnings.length} active learning(s) as rules...`));

  if (existing.length === 0) {
    console.log(chalk.yellow("No agent config files found. Run 'sheal init' first."));
    return;
  }

  // Inject into AGENTS.md if it exists (universal across CLIs), otherwise
  // fall back to the first available file. Only one file gets rules to
  // avoid duplication (e.g. CLAUDE.md references @AGENTS.md).
  const target = existing.includes("AGENTS.md") ? "AGENTS.md" : existing[0];
  const targetPath = join(projectRoot, target);
  const content = readFileSync(targetPath, "utf-8");
  const alreadyHas = content.includes(RULES_BEGIN);

  const modified = injectRulesBlock(targetPath, block, dryRun);
  if (modified) {
    const action = alreadyHas ? "Updated" : "Injected";
    console.log(`${prefix}${action} rules in ${target}`);
  } else {
    console.log(`  ${target} — already up to date`);
  }

  // Clean up rules blocks from other agent files to avoid duplication
  for (const file of existing.filter((f) => f !== target)) {
    const filepath = join(projectRoot, file);
    if (removeRulesBlock(filepath, dryRun)) {
      console.log(`${prefix}Removed duplicate rules block from ${file}`);
    }
  }

  if (dryRun) {
    console.log(chalk.gray("\nGenerated block:"));
    console.log(block);
  }

  console.log(chalk.green(`\n${prefix}Done. ${learnings.length} rule(s) in ${target}.`));
}

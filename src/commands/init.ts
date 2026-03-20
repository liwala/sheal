import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runLearnSync } from "./learn.js";

export interface InitOptions {
  projectRoot: string;
  dryRun: boolean;
}

const SHEAL_BEGIN = "<!-- BEGIN SHEAL INTEGRATION -->";
const SHEAL_END = "<!-- END SHEAL INTEGRATION -->";

const SHEAL_BLOCK = `${SHEAL_BEGIN}
## Self-Healing Workflow

Run \`sheal check\` at the start of every session to catch environment issues early.
Run \`sheal retro\` at the end of sessions to extract learnings (requires Entire.io).

### Session Learnings

Learnings are managed as ADR-style files. Run \`sheal learn list\` to view them.
- Add: \`sheal learn add "insight" --tags=foo,bar\`
- Sync from global: \`sheal learn sync\`
- See \`.sheal/learnings/\` for project-specific learnings
${SHEAL_END}`;

/** Agent instruction files we know how to inject into, in priority order. */
const AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  "CODEX.md",
  ".github/copilot-instructions.md",
];

/**
 * Inject the sheal block into an existing agent file.
 * Returns true if the file was modified.
 */
function injectIntoFile(filepath: string, dryRun: boolean): boolean {
  const content = readFileSync(filepath, "utf-8");

  // Already has the block — replace it (idempotent update)
  if (content.includes(SHEAL_BEGIN)) {
    const re = new RegExp(
      `${escapeRegExp(SHEAL_BEGIN)}[\\s\\S]*?${escapeRegExp(SHEAL_END)}`,
    );
    const updated = content.replace(re, SHEAL_BLOCK);
    if (updated === content) return false; // no change needed
    if (!dryRun) writeFileSync(filepath, updated);
    return true;
  }

  // Append to end of file
  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  const updated = content + separator + SHEAL_BLOCK + "\n";
  if (!dryRun) writeFileSync(filepath, updated);
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a minimal AGENTS.md with the sheal block if no agent files exist.
 */
function createAgentsFile(filepath: string, dryRun: boolean): void {
  const content = `# Agent Instructions\n\n${SHEAL_BLOCK}\n`;
  if (!dryRun) writeFileSync(filepath, content);
}

export async function runInit(options: InitOptions): Promise<void> {
  const { projectRoot, dryRun } = options;
  const prefix = dryRun ? "[dry-run] " : "";

  // 1. Ensure .sheal/ directory exists
  const shealDir = join(projectRoot, ".sheal");
  if (!existsSync(shealDir)) {
    console.log(`${prefix}Creating .sheal/`);
    if (!dryRun) mkdirSync(shealDir, { recursive: true });
  }

  // 2. Find and inject into agent instruction files
  const existing = AGENT_FILES.filter((f) =>
    existsSync(join(projectRoot, f)),
  );

  if (existing.length === 0) {
    // No agent files found — create AGENTS.md
    const target = join(projectRoot, "AGENTS.md");
    console.log(`${prefix}No agent instruction files found. Creating AGENTS.md`);
    if (!dryRun) createAgentsFile(target, dryRun);
  } else {
    for (const file of existing) {
      const filepath = join(projectRoot, file);
      const modified = dryRun
        ? injectIntoFile(filepath, true) || true // dry-run always reports
        : injectIntoFile(filepath, false);
      if (modified) {
        console.log(`${prefix}Injected sheal block into ${file}`);
      } else {
        console.log(`${file} already up to date`);
      }
    }
  }

  // 3. Sync learnings
  console.log(`\n${prefix}Syncing learnings...`);
  if (!dryRun) {
    await runLearnSync({ projectRoot });
  }

  console.log(`\nDone! Agents in this project will now discover sheal.`);
}

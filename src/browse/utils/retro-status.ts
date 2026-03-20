/**
 * Utilities to check retro/learning status for sessions and projects.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Check if a retro exists for a given session within a project.
 * Retros are stored at <projectRoot>/.sheal/retros/<sessionId>.md
 */
export function hasRetro(projectPath: string, sessionId: string): boolean {
  // Session IDs can be full UUIDs or short checkpoint IDs
  const retroDir = join(projectPath, ".sheal", "retros");
  if (!existsSync(retroDir)) return false;

  // Check exact match first
  if (existsSync(join(retroDir, `${sessionId}.md`))) return true;

  // Check prefix match (retros might use short checkpoint IDs)
  try {
    const files = readdirSync(retroDir);
    return files.some((f) => sessionId.startsWith(f.replace(".md", "")) || f.startsWith(sessionId));
  } catch {
    return false;
  }
}

/**
 * Load retro content for a session.
 */
export function loadRetroContent(projectPath: string, sessionId: string): string | null {
  const retroDir = join(projectPath, ".sheal", "retros");
  if (!existsSync(retroDir)) return null;

  // Exact match
  const exact = join(retroDir, `${sessionId}.md`);
  if (existsSync(exact)) return readFileSync(exact, "utf-8");

  // Prefix match
  try {
    const files = readdirSync(retroDir);
    const match = files.find((f) =>
      sessionId.startsWith(f.replace(".md", "")) || f.replace(".md", "").startsWith(sessionId),
    );
    if (match) return readFileSync(join(retroDir, match), "utf-8");
  } catch {
    // skip
  }
  return null;
}

/**
 * Count retros available for a project.
 */
export function countRetros(projectPath: string): number {
  const retroDir = join(projectPath, ".sheal", "retros");
  if (!existsSync(retroDir)) return 0;
  try {
    return readdirSync(retroDir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Count learnings for a project (both local and global).
 */
export function countLearnings(projectPath: string): { local: number; global: number } {
  let local = 0;
  let global = 0;

  const localDir = join(projectPath, ".sheal", "learnings");
  if (existsSync(localDir)) {
    try {
      local = readdirSync(localDir).filter((f) => f.startsWith("LEARN-")).length;
    } catch { /* skip */ }
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const globalDir = join(homeDir, ".sheal", "learnings");
  if (existsSync(globalDir)) {
    try {
      global = readdirSync(globalDir).filter((f) => f.startsWith("LEARN-")).length;
    } catch { /* skip */ }
  }

  return { local, global };
}

/**
 * List all retro files for a project with basic metadata.
 */
export interface RetroInfo {
  sessionId: string;
  filename: string;
  preview: string;
}

export function listRetros(projectPath: string): RetroInfo[] {
  const retroDir = join(projectPath, ".sheal", "retros");
  if (!existsSync(retroDir)) return [];

  try {
    return readdirSync(retroDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = readFileSync(join(retroDir, f), "utf-8");
        const firstLine = content.split("\n").find((l) => l.trim()) || "";
        return {
          sessionId: f.replace(".md", ""),
          filename: f,
          preview: firstLine.replace(/^\*\*Summary:\*\*\s*/, "").slice(0, 100),
        };
      });
  } catch {
    return [];
  }
}

export interface LearningInfo {
  id: string;
  title: string;
  category: string;
  severity: string;
  tags: string[];
  body: string;
}

/**
 * Info about a stored ask result.
 */
export interface AskInfo {
  filename: string;
  question: string;
  date: string;
  searchTerms: string[];
  sessionCount: number;
  preview: string;
}

/**
 * Count stored ask results for a project.
 */
export function countAsks(projectPath: string): number {
  const dir = join(projectPath, ".sheal", "asks");
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Count global ask results.
 */
export function countGlobalAsks(): number {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const dir = join(homeDir, ".sheal", "asks");
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * List ask results from a directory.
 */
export function listAsks(dir: string): AskInfo[] {
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        return parseAskFrontmatter(f, content);
      })
      .filter((a): a is AskInfo => a !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

/**
 * Load full content of an ask result.
 */
export function loadAskContent(dir: string, filename: string): string | null {
  const path = join(dir, filename);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function parseAskFrontmatter(filename: string, content: string): AskInfo | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = match[1];
  const get = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
    return m ? m[1].trim() : "";
  };
  const getArray = (key: string): string[] => {
    const raw = get(key);
    const arrMatch = raw.match(/\[([^\]]*)\]/);
    if (arrMatch) return arrMatch[1].split(",").map((s) => s.trim());
    return raw ? [raw] : [];
  };

  const bodyStart = content.indexOf("\n---", 4);
  const body = bodyStart >= 0 ? content.slice(bodyStart + 4).trim() : "";
  // Preview: first non-empty line of the answer section
  const answerMatch = body.match(/## Answer\n+([\s\S]*?)(?:\n##|$)/);
  const preview = answerMatch
    ? answerMatch[1].split("\n").find((l) => l.trim())?.slice(0, 100) || ""
    : body.split("\n").find((l) => l.trim())?.slice(0, 100) || "";

  return {
    filename,
    question: get("question"),
    date: get("date"),
    searchTerms: getArray("search_terms"),
    sessionCount: parseInt(get("sessions_matched")) || 0,
    preview,
  };
}

/**
 * List learnings from a directory with parsed frontmatter.
 */
export function listLearningFiles(dir: string): LearningInfo[] {
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"))
      .map((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        return parseLearningFrontmatter(content);
      })
      .filter((l): l is LearningInfo => l !== null);
  } catch {
    return [];
  }
}

function parseLearningFrontmatter(content: string): LearningInfo | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = match[1];
  const get = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
    return m ? m[1].trim() : "";
  };
  const getArray = (key: string): string[] => {
    const raw = get(key);
    const arrMatch = raw.match(/\[([^\]]*)\]/);
    if (arrMatch) return arrMatch[1].split(",").map((s) => s.trim());
    return raw ? [raw] : [];
  };

  // Body is everything after the closing ---
  const bodyStart = content.indexOf("\n---", 4);
  const body = bodyStart >= 0 ? content.slice(bodyStart + 4).trim() : "";

  return {
    id: get("id"),
    title: get("title"),
    category: get("category"),
    severity: get("severity"),
    tags: getArray("tags"),
    body,
  };
}

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LearningFile, LearningCategory, LearningSeverity, LearningStatus } from "./types.js";

/**
 * Get the global learnings directory (~/.sheal/learnings/).
 * Creates the directory if it doesn't exist.
 */
export function getGlobalDir(): string {
  const dir = join(homedir(), ".sheal", "learnings");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the project-local learnings directory (<root>/.sheal/learnings/).
 */
export function getProjectDir(root: string): string {
  return join(root, ".sheal", "learnings");
}

/**
 * Scan a directory for LEARN-NNN files and return the next sequential ID.
 */
export function nextId(dir: string): string {
  if (!existsSync(dir)) return "LEARN-001";

  const files = readdirSync(dir).filter((f) => f.startsWith("LEARN-"));
  if (files.length === 0) return "LEARN-001";

  const ids = files.map((f) => {
    const match = f.match(/^LEARN-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });

  const max = Math.max(...ids);
  return `LEARN-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Convert a title to a URL-friendly slug.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Render a LearningFile to its markdown string (frontmatter + body).
 */
function renderLearning(learning: LearningFile): string {
  const tags = `[${learning.tags.join(", ")}]`;
  return `---
id: ${learning.id}
title: ${learning.title}
date: ${learning.date}
tags: ${tags}
category: ${learning.category}
severity: ${learning.severity}
status: ${learning.status}
---

${learning.body.trim()}
`;
}

/**
 * Write a learning file to a directory.
 * Returns the full path of the written file.
 */
export function writeLearning(dir: string, learning: LearningFile): string {
  mkdirSync(dir, { recursive: true });
  const filename = `${learning.id}-${slugify(learning.title)}.md`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, renderLearning(learning), "utf-8");
  return filepath;
}

/**
 * Parse frontmatter from a learning markdown file.
 * Simple parser: splits on `---`, parses key: value lines.
 */
export function readLearning(path: string): LearningFile {
  const content = readFileSync(path, "utf-8");
  return parseLearningContent(content);
}

/**
 * Parse learning content from a string (frontmatter + body).
 */
export function parseLearningContent(content: string): LearningFile {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) {
    throw new Error("Invalid learning file: missing frontmatter delimiters");
  }

  // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2+] is body
  const frontmatter = parts[1].trim();
  const body = parts.slice(2).join("---").trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }

  // Parse tags array: [a, b, c]
  const tagsRaw = meta["tags"] ?? "[]";
  const tagsMatch = tagsRaw.match(/^\[(.*)]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    id: meta["id"] ?? "",
    title: meta["title"] ?? "",
    date: meta["date"] ?? "",
    tags,
    category: (meta["category"] ?? "workflow") as LearningCategory,
    severity: (meta["severity"] ?? "medium") as LearningSeverity,
    status: (meta["status"] ?? "active") as LearningStatus,
    body,
  };
}

/**
 * List all learnings in a directory.
 */
export function listLearnings(dir: string): LearningFile[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("LEARN-") && f.endsWith(".md"))
    .sort();

  return files.map((f) => readLearning(join(dir, f)));
}

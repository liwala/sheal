import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";

/**
 * Auto-detect project tags based on files and dependencies present.
 * Merges with manual tags from .self-heal.json config.
 */
export function detectProjectTags(root: string): string[] {
  const tags = new Set<string>(["general", "workflow"]);

  // Language/ecosystem detection
  if (existsSync(join(root, "package.json"))) tags.add("node").add("javascript");
  if (existsSync(join(root, "tsconfig.json"))) tags.add("typescript");
  if (existsSync(join(root, "Cargo.toml"))) tags.add("rust");
  if (existsSync(join(root, "go.mod"))) tags.add("go");
  if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "pyproject.toml"))) {
    tags.add("python");
  }
  if (existsSync(join(root, "Gemfile"))) tags.add("ruby");
  if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle"))) tags.add("java");

  // Framework detection
  if (existsSync(join(root, "next.config.js")) || existsSync(join(root, "next.config.mjs"))) {
    tags.add("nextjs").add("react");
  }
  if (existsSync(join(root, "vite.config.ts")) || existsSync(join(root, "vite.config.js"))) {
    tags.add("vite");
  }
  if (existsSync(join(root, "Dockerfile"))) tags.add("docker");

  // AI/coding tool detection
  if (existsSync(join(root, "CLAUDE.md"))) tags.add("claude");
  if (existsSync(join(root, ".cursorrules"))) tags.add("cursor");

  // Check for common file extensions in src/
  const srcDir = join(root, "src");
  if (existsSync(srcDir)) {
    try {
      const srcFiles = readdirSync(srcDir, { recursive: true }) as string[];
      for (const f of srcFiles) {
        const name = typeof f === "string" ? f : "";
        if (name.endsWith(".tsx") || name.endsWith(".jsx")) { tags.add("react"); break; }
      }
    } catch {
      // ignore read errors
    }
  }

  // Merge manual tags from config
  const config = loadConfig(root);
  if (config.learnings?.tags) {
    for (const tag of config.learnings.tags) tags.add(tag);
  }

  return [...tags].sort();
}

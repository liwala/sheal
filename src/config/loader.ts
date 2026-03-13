import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SelfHealConfig, ResolvedConfig } from "./types.js";
import { defaultConfig } from "./defaults.js";

const CONFIG_FILENAME = ".self-heal.json";

function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(projectRoot: string): ResolvedConfig {
  const configPath = findConfigFile(projectRoot);
  if (!configPath) return { ...defaultConfig };

  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as SelfHealConfig;

  return {
    skip: raw.skip ?? defaultConfig.skip,
    checkers: {
      git: { ...defaultConfig.checkers.git, ...raw.checkers?.git },
      dependencies: {
        ...defaultConfig.checkers.dependencies,
        ...raw.checkers?.dependencies,
      },
      tests: { ...defaultConfig.checkers.tests, ...raw.checkers?.tests },
      environment: {
        ...defaultConfig.checkers.environment,
        ...raw.checkers?.environment,
      },
      sessionLearnings: {
        ...defaultConfig.checkers.sessionLearnings,
        ...raw.checkers?.sessionLearnings,
      },
    },
    learnings: {
      ...defaultConfig.learnings,
      ...raw.learnings,
    },
    timeoutMs: raw.timeoutMs ?? defaultConfig.timeoutMs,
    format: raw.format ?? defaultConfig.format,
  };
}

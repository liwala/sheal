import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SelfHealConfig, ResolvedConfig } from "./types.js";
import { defaultConfig } from "./defaults.js";

const CONFIG_FILENAME = ".self-heal.json";
const LOCAL_CONFIG_FILENAME = ".self-heal.local.json";

function findConfigFile(startDir: string, filename: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readConfigFile(path: string): SelfHealConfig | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SelfHealConfig;
  } catch (e) {
    console.error(`Warning: failed to parse ${path}: ${(e as Error).message}`);
    return null;
  }
}

function mergeLayer(base: ResolvedConfig, raw: SelfHealConfig): ResolvedConfig {
  return {
    skip: raw.skip ?? base.skip,
    pull: {
      ...base.pull,
      ...raw.pull,
    },
    checkers: {
      git: { ...base.checkers.git, ...raw.checkers?.git },
      dependencies: {
        ...base.checkers.dependencies,
        ...raw.checkers?.dependencies,
      },
      tests: { ...base.checkers.tests, ...raw.checkers?.tests },
      environment: {
        ...base.checkers.environment,
        ...raw.checkers?.environment,
      },
      sessionLearnings: {
        ...base.checkers.sessionLearnings,
        ...raw.checkers?.sessionLearnings,
      },
    },
    learnings: {
      ...base.learnings,
      ...raw.learnings,
    },
    timeoutMs: raw.timeoutMs ?? base.timeoutMs,
    format: raw.format ?? base.format,
  };
}

export function loadConfig(projectRoot: string): ResolvedConfig {
  // .self-heal.local.json is a machine-local overlay (gitignored): same shape
  // as .self-heal.json, merged over it field by field. Each file is found by
  // its own upward search so a repo-root local file applies from subdirectories.
  const layers = [
    findConfigFile(projectRoot, CONFIG_FILENAME),
    findConfigFile(projectRoot, LOCAL_CONFIG_FILENAME),
  ]
    .filter((path): path is string => path !== null)
    .map(readConfigFile)
    .filter((raw): raw is SelfHealConfig => raw !== null);

  return layers.reduce(mergeLayer, { ...defaultConfig });
}

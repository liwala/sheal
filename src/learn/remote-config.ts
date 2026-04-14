import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getShealHomeDir } from "./store.js";

export interface GlobalConfig {
  remote?: {
    url: string;
  };
}

function getConfigPath(): string {
  return join(getShealHomeDir(), "config.json");
}

export function readGlobalConfig(): GlobalConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

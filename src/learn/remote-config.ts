import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface GlobalConfig {
  remote?: {
    url: string;
  };
}

function getConfigPath(): string {
  return join(homedir(), ".sheal", "config.json");
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
  mkdirSync(join(homedir(), ".sheal"), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

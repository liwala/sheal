import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PullProvenance } from "./types.js";

export interface PullStage {
  dir: string;
  pulledAt: string;
}

export function defaultPullStagingRoot(_projectRoot: string = process.cwd()): string {
  return join(homedir(), ".sheal", "pulls");
}

export function createPullStage(params: {
  stagingRoot?: string;
  backend: string;
  name: string;
  pulledAt?: Date;
}): PullStage {
  const pulledAt = (params.pulledAt ?? new Date()).toISOString();
  const dir = join(
    params.stagingRoot ?? defaultPullStagingRoot(),
    pathSegment(params.backend, "backend"),
    pathSegment(params.name, "sandbox name"),
    timestampSegment(pulledAt),
  );
  mkdirSync(dir, { recursive: true });

  return { dir, pulledAt };
}

export function writePullProvenance(stagingDir: string, provenance: PullProvenance): void {
  writeFileSync(join(stagingDir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf-8");
}

function timestampSegment(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, "-");
}

function pathSegment(value: string, label: string): string {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new Error(`${label} must be a single path segment`);
  }
  return value;
}

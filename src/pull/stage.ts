import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PullProvenance } from "./types.js";

export interface PullStage {
  dir: string;
  pulledAt: string;
}

export interface PullStagingGcResult {
  enabled: boolean;
  stagingRoot: string;
  retentionDays: number | null;
  cutoff: string | null;
  removed: string[];
  kept: string[];
  skipped: string[];
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

export function gcPullStages(params: {
  stagingRoot: string;
  retentionDays: number | null;
  now?: Date;
}): PullStagingGcResult {
  const stageDirs = listPullStageDirs(params.stagingRoot);
  if (params.retentionDays === null) {
    return {
      enabled: false,
      stagingRoot: params.stagingRoot,
      retentionDays: null,
      cutoff: null,
      removed: [],
      kept: stageDirs.map((stage) => stage.path),
      skipped: [],
    };
  }

  const now = params.now ?? new Date();
  const cutoffDate = new Date(now.getTime() - params.retentionDays * 24 * 60 * 60 * 1000);
  const result: PullStagingGcResult = {
    enabled: true,
    stagingRoot: params.stagingRoot,
    retentionDays: params.retentionDays,
    cutoff: cutoffDate.toISOString(),
    removed: [],
    kept: [],
    skipped: [],
  };

  for (const stage of stageDirs) {
    const capturedAt = parseTimestampSegment(stage.timestamp);
    if (!capturedAt) {
      result.skipped.push(stage.path);
      continue;
    }

    if (capturedAt < cutoffDate) {
      rmSync(stage.path, { recursive: true, force: true });
      result.removed.push(stage.path);
    } else {
      result.kept.push(stage.path);
    }
  }

  return result;
}

function listPullStageDirs(stagingRoot: string): Array<{ path: string; timestamp: string }> {
  if (!existsSync(stagingRoot)) return [];

  const stages: Array<{ path: string; timestamp: string }> = [];
  for (const backend of sortedDirectoryEntries(stagingRoot)) {
    const backendDir = join(stagingRoot, backend);
    for (const name of sortedDirectoryEntries(backendDir)) {
      const nameDir = join(backendDir, name);
      for (const timestamp of sortedDirectoryEntries(nameDir)) {
        stages.push({ path: join(nameDir, timestamp), timestamp });
      }
    }
  }

  return stages;
}

function sortedDirectoryEntries(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((entry) => statSync(join(dir, entry)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

function parseTimestampSegment(segment: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/.exec(segment);
  if (!match) return null;
  const isoTimestamp = `${match[1]}:${match[2]}:${match[3]}.${match[4]}`;
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? null : date;
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

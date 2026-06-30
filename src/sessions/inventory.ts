import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  listCodexSessionsForProject,
  listNativeSessions,
} from "@liwala/agent-sessions";
import type { CheckpointInfo } from "@liwala/agent-sessions";

export type SessionRegistryStatus = "registry-backed" | "live-home-only";

export interface SessionInventoryItem extends CheckpointInfo {
  registryStatus: SessionRegistryStatus;
  rawSessionId: string;
}

export interface SessionInventoryOptions {
  sourceRoot?: string;
  claudeRoot?: string;
  codexRoot?: string;
}

interface RawRegistryRecord {
  stableSessionId: string;
  nativeSessionId: string;
  agent: string;
  projectPath: string;
}

export function listProjectSessionInventory(
  projectRoot: string,
  options: SessionInventoryOptions = {},
): SessionInventoryItem[] {
  const rawRecords = listRawRegistryRecords(projectRoot);
  const rawByNativeSession = new Map<string, RawRegistryRecord>();
  for (const record of rawRecords) {
    if (!samePath(record.projectPath, projectRoot)) continue;
    rawByNativeSession.set(rawKey(record.agent, record.nativeSessionId), record);
  }

  const liveSessions: CheckpointInfo[] = [
    ...listNativeSessions(projectRoot, { root: options.claudeRoot ?? options.sourceRoot }),
    ...listCodexSessionsForProject(projectRoot, { root: options.codexRoot ?? options.sourceRoot }),
  ];

  const inventory = liveSessions.map((session): SessionInventoryItem => {
    const agent = session.agent ?? "";
    const raw = rawByNativeSession.get(rawKey(agent, session.sessionId));
    return {
      ...session,
      registryStatus: raw ? "registry-backed" : "live-home-only",
      rawSessionId: raw?.stableSessionId ?? defaultRawSessionId(agent, session.sessionId),
    };
  });

  inventory.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return inventory;
}

export function formatSessionBackupBadge(session: Pick<SessionInventoryItem, "registryStatus">): string {
  return session.registryStatus === "live-home-only" ? "[not backed up]" : "";
}

export function getSessionImportOffer(
  sessions: Array<Partial<Pick<SessionInventoryItem, "registryStatus">>>,
): string | null {
  const count = sessions.filter((session) => session.registryStatus === "live-home-only").length;
  if (count === 0) return null;
  const noun = count === 1 ? "session is" : "sessions are";
  const action = count === 1 ? "it" : "them";
  return `${count} live-home ${noun} not backed up in the sheal registry yet. Press i to add ${action}.`;
}

function listRawRegistryRecords(projectRoot: string): RawRegistryRecord[] {
  const rawRoot = join(projectRoot, ".sheal", "sessions", "raw");
  if (!existsSync(rawRoot)) return [];

  const records: RawRegistryRecord[] = [];
  for (const entry of readdirSync(rawRoot)) {
    const manifestPath = join(rawRoot, entry, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Partial<RawRegistryRecord>;
      if (
        typeof manifest.stableSessionId === "string" &&
        typeof manifest.nativeSessionId === "string" &&
        typeof manifest.agent === "string" &&
        typeof manifest.projectPath === "string"
      ) {
        records.push({
          stableSessionId: manifest.stableSessionId,
          nativeSessionId: manifest.nativeSessionId,
          agent: manifest.agent,
          projectPath: manifest.projectPath,
        });
      }
    } catch {
      // Ignore malformed raw records; inventory should still show live sessions.
    }
  }

  return records;
}

function rawKey(agent: string, nativeSessionId: string): string {
  return `${agent}\0${nativeSessionId}`;
}

function defaultRawSessionId(agent: string, nativeSessionId: string): string {
  if (agent === "Codex") return `codex:${nativeSessionId}`;
  return `claude:${nativeSessionId}`;
}

function samePath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

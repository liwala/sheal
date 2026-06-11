import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, relative } from "node:path";
import {
  codexSessionToCheckpoint,
  parseTranscript,
} from "@liwala/agent-sessions";
import type { Checkpoint, CodexSessionFile, Session, SessionEntry, TokenUsage } from "@liwala/agent-sessions";
import type { PullProvenance } from "../pull/types.js";

export interface NormalizePullStageOptions {
  projectRoot: string;
  pullDir: string;
  backend: string;
  name: string;
}

export interface NormalizePullStageResult {
  rawSessionIds: string[];
}

interface TranscriptCandidate {
  agent: "Claude Code" | "Codex";
  path: string;
}

interface CandidateNormalization {
  stableSessionId: string;
  nativeSessionId: string;
  agent: "Claude Code" | "Codex";
  projectPath: string;
  checkpoint: Checkpoint;
}

interface RawSessionManifest {
  schemaVersion: 1;
  stableSessionId: string;
  nativeSessionId: string;
  agent: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  source: {
    kind: "pull";
    backend: string;
    name: string;
    pullDir: string;
    transcriptPath: string;
  };
  hashes: {
    transcriptRawSha256?: string;
    normalizedSha256: string;
    gitDiffSha256?: string;
  };
  provenance: {
    sourcePaths: string[];
    gaps: string[];
  };
}

export function normalizePullStage(options: NormalizePullStageOptions): NormalizePullStageResult {
  const provenance = readJsonIfExists<PullProvenance>(join(options.pullDir, "provenance.json"));
  const candidates = collectTranscriptCandidates(options.pullDir);
  const rawSessionIds: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate, provenance);
    writeRawSessionRecord({
      projectRoot: options.projectRoot,
      pullDir: options.pullDir,
      backend: options.backend,
      name: options.name,
      candidate,
      normalized,
      provenance,
    });
    rawSessionIds.push(normalized.stableSessionId);
  }

  const uniqueRawSessionIds = [...new Set(rawSessionIds)];
  if (uniqueRawSessionIds.length > 0) {
    writeFileSync(
      join(options.pullDir, "ingested.json"),
      jsonWithTrailingNewline({
        schemaVersion: 1,
        ingestedAt: new Date().toISOString(),
        rawSessionIds: uniqueRawSessionIds,
      }),
      "utf-8",
    );
  }

  return { rawSessionIds: uniqueRawSessionIds };
}

function collectTranscriptCandidates(pullDir: string): TranscriptCandidate[] {
  const candidates: TranscriptCandidate[] = [];
  const claudeProjectsDir = join(pullDir, "transcript", ".claude", "projects");
  const codexSessionsDir = join(pullDir, "transcript", ".codex", "sessions");

  for (const path of collectJsonlFiles(claudeProjectsDir)) {
    candidates.push({ agent: "Claude Code", path });
  }
  for (const path of collectJsonlFiles(codexSessionsDir)) {
    candidates.push({ agent: "Codex", path });
  }

  return candidates;
}

function normalizeCandidate(
  candidate: TranscriptCandidate,
  provenance: PullProvenance | null,
): CandidateNormalization {
  const content = readFileSync(candidate.path, "utf-8");
  return candidate.agent === "Claude Code"
    ? normalizeClaudeCandidate(candidate, content, provenance)
    : normalizeCodexCandidate(candidate, content, provenance);
}

function normalizeClaudeCandidate(
  candidate: TranscriptCandidate,
  content: string,
  provenance: PullProvenance | null,
): CandidateNormalization {
  const transcript = parseTranscript(content, "Claude Code");
  const nativeSessionId = extractClaudeSessionId(content) ?? stripJsonlExtension(basename(candidate.path));
  const projectPath = extractFirstTopLevelString(content, "cwd") ?? provenance?.sourcePaths[0] ?? "";
  const createdAt = extractEarliestTimestamp(content) ?? "";
  const filesTouched = extractFilesTouched(transcript);
  const tokenUsage = extractClaudeTokenUsage(content);
  const stableSessionId = stableSessionIdFor("claude", nativeSessionId, {
    agent: "Claude Code",
    projectPath,
    content,
    provenance,
  });

  const session: Session = {
    metadata: {
      checkpointId: stableSessionId,
      sessionId: nativeSessionId,
      strategy: "pulled-raw",
      createdAt,
      checkpointsCount: 0,
      filesTouched,
      agent: "Claude Code",
      model: extractClaudeModel(content),
      tokenUsage,
    },
    transcript,
    prompts: transcript.filter((entry) => entry.type === "user").map((entry) => entry.content),
  };

  return {
    stableSessionId,
    nativeSessionId,
    agent: "Claude Code",
    projectPath,
    checkpoint: {
      root: {
        checkpointId: stableSessionId,
        strategy: "pulled-raw",
        checkpointsCount: 0,
        filesTouched,
        sessions: [],
        tokenUsage,
      },
      sessions: [session],
    },
  };
}

function normalizeCodexCandidate(
  candidate: TranscriptCandidate,
  content: string,
  provenance: PullProvenance | null,
): CandidateNormalization {
  const meta = extractCodexMeta(candidate.path, content, provenance);
  const stableSessionId = stableSessionIdFor("codex", meta.id, {
    agent: "Codex",
    projectPath: meta.cwd,
    content,
    provenance,
  });
  const checkpoint = codexSessionToCheckpoint(meta, content);
  applyStableSessionId(checkpoint, stableSessionId, meta.id);

  return {
    stableSessionId,
    nativeSessionId: meta.id,
    agent: "Codex",
    projectPath: meta.cwd,
    checkpoint,
  };
}

function writeRawSessionRecord(params: {
  projectRoot: string;
  pullDir: string;
  backend: string;
  name: string;
  candidate: TranscriptCandidate;
  normalized: CandidateNormalization;
  provenance: PullProvenance | null;
}): void {
  const rawDir = join(params.projectRoot, ".sheal", "sessions", "raw", params.normalized.stableSessionId);
  mkdirSync(rawDir, { recursive: true });

  const transcriptRaw = readFileSync(params.candidate.path, "utf-8");
  const transcriptRawPath = join(rawDir, "transcript.raw.jsonl");
  writeFileSync(transcriptRawPath, transcriptRaw, "utf-8");

  const gitDiffPath = join(params.pullDir, "git.diff");
  const stagedProvenancePath = join(params.pullDir, "provenance.json");
  const rawGitDiffPath = join(rawDir, "git.diff");
  const rawProvenancePath = join(rawDir, "provenance.json");
  const gitDiff = existsSync(gitDiffPath) ? readFileSync(gitDiffPath, "utf-8") : null;

  if (gitDiff !== null) {
    copyFileSync(gitDiffPath, rawGitDiffPath);
  } else {
    rmSync(rawGitDiffPath, { force: true });
  }

  if (existsSync(stagedProvenancePath)) {
    copyFileSync(stagedProvenancePath, rawProvenancePath);
  } else {
    rmSync(rawProvenancePath, { force: true });
  }

  const normalizedJson = jsonWithTrailingNewline(params.normalized.checkpoint);
  writeFileSync(join(rawDir, "normalized.json"), normalizedJson, "utf-8");

  const existingManifest = readJsonIfExists<RawSessionManifest>(join(rawDir, "manifest.json"));
  const now = new Date().toISOString();
  const manifest: RawSessionManifest = {
    schemaVersion: 1,
    stableSessionId: params.normalized.stableSessionId,
    nativeSessionId: params.normalized.nativeSessionId,
    agent: params.normalized.agent,
    projectPath: params.normalized.projectPath,
    createdAt: existingManifest?.createdAt ?? now,
    updatedAt: now,
    source: {
      kind: "pull",
      backend: params.backend,
      name: params.name,
      pullDir: params.pullDir,
      transcriptPath: relative(params.pullDir, params.candidate.path),
    },
    hashes: {
      transcriptRawSha256: sha256(transcriptRaw),
      normalizedSha256: sha256(normalizedJson),
      ...(gitDiff !== null ? { gitDiffSha256: sha256(gitDiff) } : {}),
    },
    provenance: {
      sourcePaths: params.provenance?.sourcePaths ?? [],
      gaps: params.provenance?.gaps ?? [],
    },
  };
  writeFileSync(join(rawDir, "manifest.json"), jsonWithTrailingNewline(manifest), "utf-8");
}

function collectJsonlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        continue;
      }

      if (isDirectory) {
        visit(path);
      } else if (entry.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  };

  visit(root);
  return files.sort();
}

function extractClaudeSessionId(content: string): string | null {
  for (const obj of parseJsonLines(content)) {
    if (typeof obj.sessionId === "string" && obj.sessionId.length > 0) return obj.sessionId;
  }
  return null;
}

function extractClaudeModel(content: string): string | undefined {
  for (const obj of parseJsonLines(content)) {
    const message = obj.message as Record<string, unknown> | undefined;
    if (typeof message?.model === "string") return message.model;
  }
  return undefined;
}

function extractClaudeTokenUsage(content: string): TokenUsage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let apiCallCount = 0;

  for (const obj of parseJsonLines(content)) {
    const message = obj.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    inputTokens += numberValue(usage.input_tokens);
    outputTokens += numberValue(usage.output_tokens);
    cacheReadTokens += numberValue(usage.cache_read_input_tokens);
    cacheCreationTokens += numberValue(usage.cache_creation_input_tokens);
    apiCallCount += 1;
  }

  return apiCallCount > 0
    ? { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, apiCallCount }
    : undefined;
}

function extractCodexMeta(
  path: string,
  content: string,
  provenance: PullProvenance | null,
): CodexSessionFile {
  for (const obj of parseJsonLines(content)) {
    if (obj.type !== "session_meta") continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    const id = stringValue(payload?.id);
    if (!id) continue;
    return {
      id,
      path,
      cwd: stringValue(payload?.cwd) ?? provenance?.sourcePaths[0] ?? "",
      timestamp: stringValue(payload?.timestamp) ?? stringValue(obj.timestamp) ?? "",
      model: stringValue(payload?.model_provider),
      cliVersion: stringValue(payload?.cli_version),
      firstPrompt: undefined,
    };
  }

  const contentHash = sha256(content).slice(0, 32);
  return {
    id: stripJsonlExtension(basename(path)) || contentHash,
    path,
    cwd: provenance?.sourcePaths[0] ?? "",
    timestamp: extractEarliestTimestamp(content) ?? "",
  };
}

function applyStableSessionId(checkpoint: Checkpoint, stableSessionId: string, nativeSessionId: string): void {
  checkpoint.root.checkpointId = stableSessionId;
  for (const session of checkpoint.sessions) {
    session.metadata.checkpointId = stableSessionId;
    session.metadata.sessionId = nativeSessionId;
    session.metadata.strategy = "pulled-raw";
  }
}

function stableSessionIdFor(
  prefix: "claude" | "codex",
  nativeSessionId: string,
  fallback: {
    agent: string;
    projectPath: string;
    content: string;
    provenance: PullProvenance | null;
  },
): string {
  if (isSafePathSegment(nativeSessionId)) return `${prefix}:${nativeSessionId}`;

  const fingerprint = sha256([
    fallback.agent,
    fallback.projectPath,
    sha256(fallback.content),
    ...(fallback.provenance?.sourcePaths ?? []),
  ].join("\0")).slice(0, 32);
  return `${prefix}:${fingerprint}`;
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
}

function extractFirstTopLevelString(content: string, key: string): string | null {
  for (const obj of parseJsonLines(content)) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function extractEarliestTimestamp(content: string): string | null {
  let earliest: string | null = null;
  for (const obj of parseJsonLines(content)) {
    const timestamp = stringValue(obj.timestamp);
    if (timestamp && (!earliest || timestamp < earliest)) earliest = timestamp;
  }
  return earliest;
}

function extractFilesTouched(transcript: SessionEntry[]): string[] {
  const files = new Set<string>();
  for (const entry of transcript) {
    for (const file of entry.filesAffected ?? []) {
      files.add(file);
    }
  }
  return [...files];
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed.push(value as Record<string, unknown>);
      }
    } catch {
      // skip malformed lines
    }
  }
  return parsed;
}

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function jsonWithTrailingNewline(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stripJsonlExtension(file: string): string {
  return file.endsWith(".jsonl") ? file.slice(0, -".jsonl".length) : file;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

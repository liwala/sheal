import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import {
  codexSessionToCheckpoint,
  parseTranscript,
} from "@liwala/agent-sessions";
import type { Checkpoint, CodexSessionFile, Session, SessionEntry, TokenUsage } from "@liwala/agent-sessions";
import type { PullCorrelationHint, PullProvenance } from "../pull/types.js";

export interface NormalizePullStageOptions {
  projectRoot: string;
  pullDir: string;
  backend: string;
  name: string;
}

export interface NormalizePullStageResult {
  rawSessionIds: string[];
}

export interface NormalizeSessionSourceOptions {
  projectRoot: string;
  sourceRoot?: string;
}

export interface NormalizeSessionSourceResult {
  rawSessionIds: string[];
}

interface TranscriptCandidate {
  agent: "Claude Code" | "Codex";
  path: string;
}

interface SourceTranscriptCandidate extends TranscriptCandidate {
  root: string;
  sourceKind: "live-home" | "explicit-source";
}

interface CandidateNormalization {
  stableSessionId: string;
  nativeSessionId: string;
  agent: "Claude Code" | "Codex";
  projectPath: string;
  checkpoint: Checkpoint;
}

type RawSessionSource =
  | {
      kind: "pull";
      backend: string;
      name: string;
      pullDir: string;
      transcriptPath?: string;
    }
  | {
      kind: "live-home" | "explicit-source";
      root: string;
      transcriptPath: string;
    };

type RawSessionFidelity = "git-only" | "transcript-only" | "transcript+diff";

interface RawSessionHashes {
  transcriptRawSha256?: string;
  normalizedSha256?: string;
  gitDiffSha256?: string;
}

interface RawSessionProvenance {
  sourcePaths: string[];
  gaps: string[];
}

interface RawSessionCapture {
  id: string;
  capturedAt: string;
  source: RawSessionSource;
  fidelity: RawSessionFidelity;
  hashes: RawSessionHashes;
  provenance: RawSessionProvenance;
  aliases: string[];
  correlationHints: PullCorrelationHint[];
  needsLink: boolean;
  primary: boolean;
}

interface RawSessionManifest {
  schemaVersion: 1;
  stableSessionId: string;
  nativeSessionId: string;
  agent: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  source: RawSessionSource;
  hashes: RawSessionHashes;
  provenance: RawSessionProvenance;
  identity?: {
    canonicalSessionId: string;
    authoritativeAliases: string[];
    correlationHints: PullCorrelationHint[];
    needsLink: boolean;
  };
  captures?: RawSessionCapture[];
}

interface PendingRawSessionCapture {
  stableSessionId: string;
  nativeSessionId: string;
  agent: string;
  projectPath: string;
  capture: RawSessionCapture;
  transcriptRaw?: string;
  normalizedJson?: string;
  gitDiff?: string;
  provenanceJson?: string;
}

export function normalizePullStage(options: NormalizePullStageOptions): NormalizePullStageResult {
  const provenance = readJsonIfExists<PullProvenance>(join(options.pullDir, "provenance.json"));
  const candidates = collectTranscriptCandidates(options.pullDir);
  const rawSessionIds: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate, provenance);
    const rawSessionId = writeRawSessionRecord({
      projectRoot: options.projectRoot,
      pullDir: options.pullDir,
      backend: options.backend,
      name: options.name,
      candidate,
      normalized,
      provenance,
    });
    rawSessionIds.push(rawSessionId);
  }

  if (candidates.length === 0) {
    const rawSessionId = writeGitOnlyPullRecord({
      projectRoot: options.projectRoot,
      pullDir: options.pullDir,
      backend: options.backend,
      name: options.name,
      provenance,
    });
    if (rawSessionId) {
      rawSessionIds.push(rawSessionId);
    }
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

export function normalizeSessionSource(options: NormalizeSessionSourceOptions): NormalizeSessionSourceResult {
  const sourceKind = options.sourceRoot ? "explicit-source" : "live-home";
  const candidates = collectSourceTranscriptCandidates({
    projectRoot: options.projectRoot,
    sourceRoot: options.sourceRoot,
    sourceKind,
  });
  const rawSessionIds: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate, null);
    const rawSessionId = writeSourceRawSessionRecord({
      projectRoot: options.projectRoot,
      candidate,
      normalized,
    });
    rawSessionIds.push(rawSessionId);
  }

  return { rawSessionIds: [...new Set(rawSessionIds)] };
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

function collectSourceTranscriptCandidates(options: {
  projectRoot: string;
  sourceRoot?: string;
  sourceKind: "live-home" | "explicit-source";
}): SourceTranscriptCandidate[] {
  const candidates: SourceTranscriptCandidate[] = [];
  const claudeRoot = resolveClaudeRoot(options.sourceRoot);
  const codexRoot = resolveCodexRoot(options.sourceRoot);
  const claudeProjectDir = claudeProjectDirFor(options.projectRoot, claudeRoot);

  const claudePaths = existsSync(claudeProjectDir)
    ? collectJsonlFiles(claudeProjectDir)
    : collectClaudeJsonlFilesByProjectCwd(claudeRoot, options.projectRoot);

  for (const path of claudePaths) {
    candidates.push({
      agent: "Claude Code",
      path,
      root: claudeRoot,
      sourceKind: options.sourceKind,
    });
  }

  for (const path of collectJsonlFiles(join(codexRoot, "sessions"))) {
    const content = readFileSync(path, "utf-8");
    const meta = extractCodexMeta(path, content, null);
    if (samePath(meta.cwd, options.projectRoot)) {
      candidates.push({
        agent: "Codex",
        path,
        root: codexRoot,
        sourceKind: options.sourceKind,
      });
    }
  }

  return candidates.sort((a, b) => a.path.localeCompare(b.path));
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
}): string {
  const transcriptRaw = readFileSync(params.candidate.path, "utf-8");
  const gitDiffPath = join(params.pullDir, "git.diff");
  const stagedProvenancePath = join(params.pullDir, "provenance.json");
  const gitDiff = existsSync(gitDiffPath) ? readFileSync(gitDiffPath, "utf-8") : null;
  const provenanceJson = existsSync(stagedProvenancePath) ? readFileSync(stagedProvenancePath, "utf-8") : undefined;
  const aliases = authoritativeAliasesForTranscript(params.normalized.agent, params.normalized.nativeSessionId, transcriptRaw);
  const stableSessionId = resolveCanonicalSessionId(params.projectRoot, params.normalized.stableSessionId, aliases);
  applyStableSessionId(params.normalized.checkpoint, stableSessionId, params.normalized.nativeSessionId);
  const normalizedJson = jsonWithTrailingNewline(params.normalized.checkpoint);
  const now = new Date().toISOString();
  const hashes: RawSessionHashes = {
    transcriptRawSha256: sha256(transcriptRaw),
    normalizedSha256: sha256(normalizedJson),
    ...(gitDiff !== null ? { gitDiffSha256: sha256(gitDiff) } : {}),
  };
  const capture = buildCapture({
    capturedAt: now,
    source: {
      kind: "pull",
      backend: params.backend,
      name: params.name,
      pullDir: params.pullDir,
      transcriptPath: relative(params.pullDir, params.candidate.path),
    },
    fidelity: gitDiff !== null ? "transcript+diff" : "transcript-only",
    hashes,
    provenance: {
      sourcePaths: params.provenance?.sourcePaths ?? [],
      gaps: params.provenance?.gaps ?? [],
    },
    aliases,
    correlationHints: correlationHintsFromProvenance(params.provenance),
  });

  persistRawSessionCapture({
    projectRoot: params.projectRoot,
    stableSessionId,
    nativeSessionId: params.normalized.nativeSessionId,
    agent: params.normalized.agent,
    projectPath: params.normalized.projectPath,
    capture,
    transcriptRaw,
    normalizedJson,
    ...(gitDiff !== null ? { gitDiff } : {}),
    ...(provenanceJson ? { provenanceJson } : {}),
  });

  return stableSessionId;
}

function writeSourceRawSessionRecord(params: {
  projectRoot: string;
  candidate: SourceTranscriptCandidate;
  normalized: CandidateNormalization;
}): string {
  const transcriptRaw = readFileSync(params.candidate.path, "utf-8");
  const aliases = authoritativeAliasesForTranscript(params.normalized.agent, params.normalized.nativeSessionId, transcriptRaw);
  const stableSessionId = resolveCanonicalSessionId(params.projectRoot, params.normalized.stableSessionId, aliases);
  applyStableSessionId(params.normalized.checkpoint, stableSessionId, params.normalized.nativeSessionId);
  const normalizedJson = jsonWithTrailingNewline(params.normalized.checkpoint);
  const now = new Date().toISOString();
  const capture = buildCapture({
    capturedAt: now,
    source: {
      kind: params.candidate.sourceKind,
      root: params.candidate.root,
      transcriptPath: relative(params.candidate.root, params.candidate.path),
    },
    fidelity: "transcript-only",
    hashes: {
      transcriptRawSha256: sha256(transcriptRaw),
      normalizedSha256: sha256(normalizedJson),
    },
    provenance: {
      sourcePaths: [params.candidate.path],
      gaps: [],
    },
    aliases,
    correlationHints: [],
  });

  persistRawSessionCapture({
    projectRoot: params.projectRoot,
    stableSessionId,
    nativeSessionId: params.normalized.nativeSessionId,
    agent: params.normalized.agent,
    projectPath: params.normalized.projectPath,
    capture,
    transcriptRaw,
    normalizedJson,
  });

  return stableSessionId;
}

function writeGitOnlyPullRecord(params: {
  projectRoot: string;
  pullDir: string;
  backend: string;
  name: string;
  provenance: PullProvenance | null;
}): string | null {
  const gitDiffPath = join(params.pullDir, "git.diff");
  if (!existsSync(gitDiffPath)) return null;

  const gitDiff = readFileSync(gitDiffPath, "utf-8");
  const stagedProvenancePath = join(params.pullDir, "provenance.json");
  const provenanceJson = existsSync(stagedProvenancePath) ? readFileSync(stagedProvenancePath, "utf-8") : undefined;
  const stableSessionId = `unlinked:${sha256([
    params.backend,
    params.name,
    params.pullDir,
    sha256(gitDiff),
    ...(params.provenance?.sourcePaths ?? []),
  ].join("\0")).slice(0, 32)}`;
  const now = new Date().toISOString();
  const capture = buildCapture({
    capturedAt: now,
    source: {
      kind: "pull",
      backend: params.backend,
      name: params.name,
      pullDir: params.pullDir,
    },
    fidelity: "git-only",
    hashes: {
      gitDiffSha256: sha256(gitDiff),
    },
    provenance: {
      sourcePaths: params.provenance?.sourcePaths ?? [],
      gaps: params.provenance?.gaps ?? [],
    },
    aliases: [],
    correlationHints: correlationHintsFromProvenance(params.provenance),
  });

  persistRawSessionCapture({
    projectRoot: params.projectRoot,
    stableSessionId,
    nativeSessionId: stableSessionId,
    agent: params.provenance?.agent ?? params.backend,
    projectPath: params.provenance?.sourcePaths[0] ?? "",
    capture,
    gitDiff,
    ...(provenanceJson ? { provenanceJson } : {}),
  });

  return stableSessionId;
}

function persistRawSessionCapture(params: PendingRawSessionCapture & { projectRoot: string }): void {
  const rawDir = join(params.projectRoot, ".sheal", "sessions", "raw", params.stableSessionId);
  mkdirSync(rawDir, { recursive: true });

  const manifestPath = join(rawDir, "manifest.json");
  const existingManifest = readJsonIfExists<RawSessionManifest>(manifestPath);
  const existingCaptures = capturesFromManifest(existingManifest);
  const captures = [...existingCaptures, params.capture];
  const primaryIndex = selectPrimaryCaptureIndex(captures);
  const capturesWithPrimary = captures.map((capture, index) => ({
    ...capture,
    primary: index === primaryIndex,
  }));
  const primaryCapture = capturesWithPrimary[primaryIndex];
  if (!primaryCapture) {
    throw new Error(`raw session ${params.stableSessionId} has no primary capture`);
  }

  if (params.capture.id === primaryCapture.id) {
    writePrimaryRawMaterial(rawDir, params);
  }

  const authoritativeAliases = uniqueStrings([
    ...(existingManifest?.identity?.authoritativeAliases ?? []),
    ...capturesWithPrimary.flatMap((capture) => capture.aliases),
  ]);
  const correlationHints = uniqueHints([
    ...(existingManifest?.identity?.correlationHints ?? []),
    ...capturesWithPrimary.flatMap((capture) => capture.correlationHints),
  ]);
  const now = new Date().toISOString();
  const manifest: RawSessionManifest = {
    schemaVersion: 1,
    stableSessionId: params.stableSessionId,
    nativeSessionId: existingManifest?.nativeSessionId ?? params.nativeSessionId,
    agent: existingManifest?.agent ?? params.agent,
    projectPath: existingManifest?.projectPath || params.projectPath,
    createdAt: existingManifest?.createdAt ?? now,
    updatedAt: now,
    source: primaryCapture.source,
    hashes: primaryCapture.hashes,
    provenance: primaryCapture.provenance,
    identity: {
      canonicalSessionId: params.stableSessionId,
      authoritativeAliases,
      correlationHints,
      needsLink: authoritativeAliases.length === 0,
    },
    captures: capturesWithPrimary,
  };

  writeFileSync(manifestPath, jsonWithTrailingNewline(manifest), "utf-8");
}

function writePrimaryRawMaterial(rawDir: string, capture: PendingRawSessionCapture): void {
  if (capture.transcriptRaw !== undefined) {
    writeFileSync(join(rawDir, "transcript.raw.jsonl"), capture.transcriptRaw, "utf-8");
  } else {
    rmSync(join(rawDir, "transcript.raw.jsonl"), { force: true });
  }

  if (capture.normalizedJson !== undefined) {
    writeFileSync(join(rawDir, "normalized.json"), capture.normalizedJson, "utf-8");
  } else {
    rmSync(join(rawDir, "normalized.json"), { force: true });
  }

  if (capture.gitDiff !== undefined) {
    writeFileSync(join(rawDir, "git.diff"), capture.gitDiff, "utf-8");
  } else {
    rmSync(join(rawDir, "git.diff"), { force: true });
  }

  if (capture.provenanceJson !== undefined) {
    writeFileSync(join(rawDir, "provenance.json"), capture.provenanceJson, "utf-8");
  } else {
    rmSync(join(rawDir, "provenance.json"), { force: true });
  }
}

function buildCapture(params: {
  capturedAt: string;
  source: RawSessionSource;
  fidelity: RawSessionFidelity;
  hashes: RawSessionHashes;
  provenance: RawSessionProvenance;
  aliases: string[];
  correlationHints: PullCorrelationHint[];
}): RawSessionCapture {
  const aliases = uniqueStrings(params.aliases);
  const correlationHints = uniqueHints(params.correlationHints);
  return {
    id: `capture:${sha256([
      params.capturedAt,
      params.fidelity,
      JSON.stringify(params.source),
      JSON.stringify(params.hashes),
    ].join("\0")).slice(0, 24)}`,
    capturedAt: params.capturedAt,
    source: params.source,
    fidelity: params.fidelity,
    hashes: params.hashes,
    provenance: params.provenance,
    aliases,
    correlationHints,
    needsLink: aliases.length === 0,
    primary: false,
  };
}

function capturesFromManifest(manifest: RawSessionManifest | null): RawSessionCapture[] {
  if (!manifest) return [];
  if (Array.isArray(manifest.captures)) {
    return manifest.captures;
  }

  const aliases = aliasesFromManifest(manifest);
  return [{
    id: `capture:${sha256([
      manifest.createdAt,
      JSON.stringify(manifest.source),
      JSON.stringify(manifest.hashes),
    ].join("\0")).slice(0, 24)}`,
    capturedAt: manifest.createdAt,
    source: manifest.source,
    fidelity: fidelityFromHashes(manifest.hashes),
    hashes: manifest.hashes,
    provenance: manifest.provenance,
    aliases,
    correlationHints: manifest.identity?.correlationHints ?? [],
    needsLink: aliases.length === 0,
    primary: true,
  }];
}

function selectPrimaryCaptureIndex(captures: RawSessionCapture[]): number {
  let primaryIndex = captures.findIndex((capture) => capture.primary);
  if (primaryIndex < 0) primaryIndex = 0;
  let primaryRank = fidelityRank(captures[primaryIndex]?.fidelity ?? "git-only");

  captures.forEach((capture, index) => {
    const rank = fidelityRank(capture.fidelity);
    if (rank > primaryRank) {
      primaryIndex = index;
      primaryRank = rank;
    }
  });

  return primaryIndex;
}

function fidelityFromHashes(hashes: RawSessionHashes): RawSessionFidelity {
  if (hashes.transcriptRawSha256 && hashes.gitDiffSha256) return "transcript+diff";
  if (hashes.transcriptRawSha256) return "transcript-only";
  return "git-only";
}

function fidelityRank(fidelity: RawSessionFidelity): number {
  switch (fidelity) {
    case "transcript+diff":
      return 3;
    case "transcript-only":
      return 2;
    case "git-only":
      return 1;
  }
}

function resolveCanonicalSessionId(projectRoot: string, preferredStableSessionId: string, aliases: string[]): string {
  if (aliases.length === 0) return preferredStableSessionId;

  const rawRoot = join(projectRoot, ".sheal", "sessions", "raw");
  if (!existsSync(rawRoot)) return preferredStableSessionId;

  const aliasSet = new Set(aliases);
  for (const entry of readdirSync(rawRoot).sort()) {
    const manifest = readJsonIfExists<RawSessionManifest>(join(rawRoot, entry, "manifest.json"));
    if (!manifest) continue;
    if (aliasesFromManifest(manifest).some((alias) => aliasSet.has(alias))) {
      return manifest.stableSessionId;
    }
  }

  return preferredStableSessionId;
}

function aliasesFromManifest(manifest: RawSessionManifest): string[] {
  const aliases = manifest.identity?.authoritativeAliases ?? [];
  if (aliases.length > 0) return aliases;

  return uniqueStrings([
    ...authoritativeAliasesForNativeSession(manifest.agent, manifest.nativeSessionId),
    ...(manifest.hashes.transcriptRawSha256 ? [`transcript-sha256:${manifest.hashes.transcriptRawSha256}`] : []),
  ]);
}

function authoritativeAliasesForTranscript(
  agent: "Claude Code" | "Codex",
  nativeSessionId: string,
  transcriptRaw: string,
): string[] {
  return uniqueStrings([
    ...authoritativeAliasesForNativeSession(agent, nativeSessionId),
    `transcript-sha256:${sha256(transcriptRaw)}`,
  ]);
}

function authoritativeAliasesForNativeSession(agent: string, nativeSessionId: string): string[] {
  if (!nativeSessionId) return [];
  return [`agent-session:${agentSlug(agent)}:${nativeSessionId}`];
}

function agentSlug(agent: string): string {
  return agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function correlationHintsFromProvenance(provenance: PullProvenance | null): PullCorrelationHint[] {
  return uniqueHints([
    ...(provenance?.correlationHints ?? []),
    ...correlationHintsFromMetadata(provenance?.metadata),
  ]);
}

function correlationHintsFromMetadata(metadata: Record<string, string> | undefined): PullCorrelationHint[] {
  if (!metadata) return [];
  return uniqueHints([
    metadata.prUrl ? { kind: "pr-url", value: metadata.prUrl } : null,
    metadata.pullRequestUrl ? { kind: "pr-url", value: metadata.pullRequestUrl } : null,
    metadata.branch ? { kind: "branch", value: metadata.branch } : null,
    metadata.commit ? { kind: "commit", value: metadata.commit } : null,
    metadata.commitSha ? { kind: "commit", value: metadata.commitSha } : null,
  ].filter((hint): hint is PullCorrelationHint => hint !== null));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function uniqueHints(hints: PullCorrelationHint[]): PullCorrelationHint[] {
  const seen = new Set<string>();
  return hints.filter((hint) => {
    const key = `${hint.kind}\0${hint.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function resolveClaudeRoot(sourceRoot?: string): string {
  if (!sourceRoot) return join(homedir(), ".claude");
  const root = resolve(sourceRoot);
  if (existsSync(join(root, "projects"))) return root;
  if (existsSync(join(root, ".claude", "projects"))) return join(root, ".claude");
  return root;
}

function resolveCodexRoot(sourceRoot?: string): string {
  if (!sourceRoot) return join(homedir(), ".codex");
  const root = resolve(sourceRoot);
  if (basename(root) === "sessions") return dirname(root);
  if (existsSync(join(root, "sessions"))) return root;
  if (existsSync(join(root, ".codex", "sessions"))) return join(root, ".codex");
  return root;
}

function claudeProjectDirFor(projectRoot: string, claudeRoot: string): string {
  const slug = resolve(projectRoot).replace(/[\\/: ]/g, "-");
  const dir = join(claudeRoot, "projects", slug);
  if (existsSync(dir)) return dir;

  const lowerSlug = slug.charAt(0).toLowerCase() + slug.slice(1);
  if (lowerSlug !== slug) {
    const lowerDir = join(claudeRoot, "projects", lowerSlug);
    if (existsSync(lowerDir)) return lowerDir;
  }

  return dir;
}

function collectClaudeJsonlFilesByProjectCwd(claudeRoot: string, projectRoot: string): string[] {
  return collectJsonlFiles(join(claudeRoot, "projects")).filter((path) => {
    const content = readFileSync(path, "utf-8");
    const cwd = extractFirstTopLevelString(content, "cwd");
    return cwd ? samePath(cwd, projectRoot) : false;
  });
}

function samePath(a: string, b: string): boolean {
  return a.length > 0 && canonicalPath(a) === canonicalPath(b);
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
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

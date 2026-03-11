/**
 * Reads session data from Entire.io's entire/checkpoints/v1 git branch.
 *
 * Entire.io stores committed checkpoints on a separate git branch with this structure:
 *   <checkpoint-id[:2]>/<checkpoint-id[2:]>/
 *   ├── metadata.json         # CheckpointRoot (aggregated summary)
 *   ├── 1/                    # First session
 *   │   ├── metadata.json     # SessionMetadata
 *   │   ├── full.jsonl        # Transcript
 *   │   └── prompt.txt        # User prompts
 *   ├── 2/                    # Second session
 *   └── ...
 */

import { exec } from "../utils/exec.js";
import type {
  Checkpoint,
  CheckpointInfo,
  CheckpointRoot,
  Session,
  SessionEntry,
  SessionMetadata,
} from "./types.js";
import { parseTranscript } from "./transcript.js";

const CHECKPOINT_BRANCH = "entire/checkpoints/v1";

/**
 * Read a file from the checkpoints branch using git show.
 */
async function readBranchFile(
  repoPath: string,
  filePath: string,
): Promise<string | null> {
  const result = await exec(
    "git",
    ["show", `${CHECKPOINT_BRANCH}:${filePath}`],
    { cwd: repoPath, timeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * List all files on the checkpoints branch.
 */
async function listBranchFiles(repoPath: string): Promise<string[]> {
  const result = await exec(
    "git",
    ["ls-tree", "-r", "--name-only", CHECKPOINT_BRANCH],
    { cwd: repoPath, timeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

/**
 * Check if the entire/checkpoints/v1 branch exists.
 */
export async function hasEntireBranch(repoPath: string): Promise<boolean> {
  const result = await exec(
    "git",
    ["rev-parse", "--verify", `refs/heads/${CHECKPOINT_BRANCH}`],
    { cwd: repoPath, timeoutMs: 5_000 },
  );
  // Also check remotes
  if (result.exitCode !== 0) {
    const remoteResult = await exec(
      "git",
      ["rev-parse", "--verify", `refs/remotes/origin/${CHECKPOINT_BRANCH}`],
      { cwd: repoPath, timeoutMs: 5_000 },
    );
    return remoteResult.exitCode === 0;
  }
  return true;
}

/**
 * List all committed checkpoints (lightweight — no transcripts loaded).
 */
export async function listCheckpoints(
  repoPath: string,
): Promise<CheckpointInfo[]> {
  const files = await listBranchFiles(repoPath);

  // Find root metadata.json files (pattern: XX/YYYYYYYYYY/metadata.json)
  // Exclude session subdirectory metadata (XX/YYYYYYYYYY/N/metadata.json)
  const rootMetadataFiles = files.filter((f) => {
    const parts = f.split("/");
    return parts.length === 3 && parts[2] === "metadata.json";
  });

  const checkpoints: CheckpointInfo[] = [];

  for (const metaFile of rootMetadataFiles) {
    const content = await readBranchFile(repoPath, metaFile);
    if (!content) continue;

    try {
      const root = JSON.parse(content) as CheckpointRoot;
      checkpoints.push({
        checkpointId: root.checkpointId,
        sessionId: root.sessions?.[0]?.metadata?.split("/").slice(-2, -1)[0] ?? "",
        createdAt: "", // resolved from session metadata
        filesTouched: root.filesTouched ?? [],
        sessionCount: root.sessions?.length ?? 0,
        sessionIds: [],
      });
    } catch {
      // Skip malformed metadata
    }
  }

  return checkpoints;
}

/**
 * Load a full checkpoint with all session data.
 */
export async function loadCheckpoint(
  repoPath: string,
  checkpointId: string,
): Promise<Checkpoint | null> {
  const prefix = checkpointId.slice(0, 2);
  const suffix = checkpointId.slice(2);
  const basePath = `${prefix}/${suffix}`;

  // Read root metadata
  const rootContent = await readBranchFile(repoPath, `${basePath}/metadata.json`);
  if (!rootContent) return null;

  const root = JSON.parse(rootContent) as CheckpointRoot;

  // Load each session
  const sessions: Session[] = [];
  const files = await listBranchFiles(repoPath);

  // Find session directories (pattern: XX/YYYYYYYYYY/N/)
  const sessionDirs = new Set<string>();
  for (const f of files) {
    if (f.startsWith(basePath + "/")) {
      const relative = f.slice(basePath.length + 1);
      const parts = relative.split("/");
      if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
        sessionDirs.add(parts[0]);
      }
    }
  }

  for (const sessionDir of Array.from(sessionDirs).sort()) {
    const sessionPath = `${basePath}/${sessionDir}`;
    const session = await loadSession(repoPath, sessionPath);
    if (session) sessions.push(session);
  }

  return { root, sessions };
}

/**
 * Load a single session from a checkpoint.
 */
async function loadSession(
  repoPath: string,
  sessionPath: string,
): Promise<Session | null> {
  // Read session metadata
  const metaContent = await readBranchFile(repoPath, `${sessionPath}/metadata.json`);
  if (!metaContent) return null;

  const metadata = parseMetadata(metaContent);

  // Read transcript (JSONL format)
  const transcriptContent = await readBranchFile(repoPath, `${sessionPath}/full.jsonl`);
  const rawTranscript = transcriptContent ?? "";
  const transcript = transcriptContent ? parseTranscript(transcriptContent, metadata.agent) : [];

  // Read prompts
  const promptContent = await readBranchFile(repoPath, `${sessionPath}/prompt.txt`);
  const prompts = promptContent ? promptContent.trim().split("\n") : [];

  return { metadata, transcript, prompts, rawTranscript };
}

/**
 * Parse metadata.json, normalizing snake_case JSON keys to camelCase.
 */
function parseMetadata(content: string): SessionMetadata {
  const raw = JSON.parse(content);
  return {
    cliVersion: raw.cli_version,
    checkpointId: raw.checkpoint_id,
    sessionId: raw.session_id,
    strategy: raw.strategy,
    createdAt: raw.created_at,
    branch: raw.branch,
    checkpointsCount: raw.checkpoints_count,
    filesTouched: raw.files_touched ?? [],
    agent: raw.agent,
    model: raw.model,
    turnId: raw.turn_id,
    isTask: raw.is_task,
    toolUseId: raw.tool_use_id,
    tokenUsage: raw.token_usage ? {
      inputTokens: raw.token_usage.input_tokens,
      cacheCreationTokens: raw.token_usage.cache_creation_tokens,
      cacheReadTokens: raw.token_usage.cache_read_tokens,
      outputTokens: raw.token_usage.output_tokens,
      apiCallCount: raw.token_usage.api_call_count,
    } : undefined,
    sessionMetrics: raw.session_metrics ? {
      durationMs: raw.session_metrics.duration_ms,
      turnCount: raw.session_metrics.turn_count,
      contextTokens: raw.session_metrics.context_tokens,
      contextWindowSize: raw.session_metrics.context_window_size,
    } : undefined,
    summary: raw.summary ? {
      intent: raw.summary.intent,
      outcome: raw.summary.outcome,
      learnings: {
        repo: raw.summary.learnings?.repo ?? [],
        code: (raw.summary.learnings?.code ?? []).map((c: Record<string, unknown>) => ({
          path: c.path,
          line: c.line,
          endLine: c.end_line,
          finding: c.finding,
        })),
        workflow: raw.summary.learnings?.workflow ?? [],
      },
      friction: raw.summary.friction ?? [],
      openItems: raw.summary.open_items ?? [],
    } : undefined,
    initialAttribution: raw.initial_attribution ? {
      calculatedAt: raw.initial_attribution.calculated_at,
      agentLines: raw.initial_attribution.agent_lines,
      humanAdded: raw.initial_attribution.human_added,
      humanModified: raw.initial_attribution.human_modified,
      humanRemoved: raw.initial_attribution.human_removed,
      totalCommitted: raw.initial_attribution.total_committed,
      agentPercentage: raw.initial_attribution.agent_percentage,
    } : undefined,
    checkpointTranscriptStart: raw.checkpoint_transcript_start,
  };
}

/**
 * Load all checkpoints with full session data.
 * Use with caution on repos with many checkpoints — prefer listCheckpoints + loadCheckpoint.
 */
export async function loadAllCheckpoints(
  repoPath: string,
): Promise<Checkpoint[]> {
  const infos = await listCheckpoints(repoPath);
  const checkpoints: Checkpoint[] = [];

  for (const info of infos) {
    const cp = await loadCheckpoint(repoPath, info.checkpointId);
    if (cp) checkpoints.push(cp);
  }

  return checkpoints;
}

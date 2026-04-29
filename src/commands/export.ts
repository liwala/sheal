import { hasEntireBranch, listCheckpoints, loadCheckpoint } from "@liwala/agent-sessions";
import {
  hasNativeTranscripts,
  listNativeSessions,
  loadNativeSession,
  listAllNativeProjects,
  listNativeSessionsBySlug,
} from "@liwala/agent-sessions";

export interface ExportOptions {
  projectRoot: string;
  checkpointId?: string;
  global?: boolean;
}

export async function runExport(options: ExportOptions): Promise<void> {
  if (options.global) {
    runGlobalExport();
    return;
  }

  const repoPath = options.projectRoot;

  // Try Entire.io first
  const hasBranch = await hasEntireBranch(repoPath);
  if (hasBranch) {
    if (options.checkpointId) {
      const checkpoint = await loadCheckpoint(repoPath, options.checkpointId);
      if (!checkpoint) {
        console.error(JSON.stringify({ error: `Checkpoint ${options.checkpointId} not found` }));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(checkpoint, null, 2));
      return;
    }

    const checkpoints = await listCheckpoints(repoPath);
    if (checkpoints.length > 0) {
      console.log(JSON.stringify({ source: "entire.io", checkpoints }, null, 2));
      return;
    }
  }

  // Fall back to native Claude Code transcripts
  if (hasNativeTranscripts(repoPath)) {
    if (options.checkpointId) {
      const checkpoint = loadNativeSession(repoPath, options.checkpointId);
      if (!checkpoint) {
        console.error(JSON.stringify({ error: `Session ${options.checkpointId} not found` }));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(checkpoint, null, 2));
      return;
    }

    const sessions = listNativeSessions(repoPath);
    if (sessions.length > 0) {
      console.log(JSON.stringify({ source: "claude-native", checkpoints: sessions }, null, 2));
      return;
    }
  }

  console.log(JSON.stringify({ error: "No session data found" }));
}

function runGlobalExport(): void {
  const projects = listAllNativeProjects();

  if (projects.length === 0) {
    console.log(JSON.stringify({ error: "No Claude Code projects found" }));
    return;
  }

  const data = projects.map((p) => ({
    ...p,
    sessions: listNativeSessionsBySlug(p.slug).map((s) => ({
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      title: s.title,
    })),
  }));
  console.log(JSON.stringify({ source: "claude-native-global", projects: data }, null, 2));
}

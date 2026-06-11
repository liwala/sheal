import { dirname, join, posix } from "node:path";
import type { PullArtifactKind } from "./types.js";

export interface CaptureCandidate {
  kind: PullArtifactKind;
  sourcePath(context: CaptureContext): string;
  copyDestination(stagingDir: string, context: CaptureContext): string;
  stagedPath(stagingDir: string, context: CaptureContext): string;
  ensureDestinationDir(stagingDir: string, context: CaptureContext): string;
  reportMissing: boolean;
}

export interface CaptureContext {
  workspace: string;
  home: string;
  agent: string;
}

const SUPPORTED_AGENT_HOME_ARTIFACT_DIRS = [
  ".claude",
  ".codex",
  ".copilot",
  ".cursor",
  ".docker-agent",
  ".droid",
  ".gemini",
  ".kiro",
  ".opencode",
];

export const ORDERED_CAPTURE_CANDIDATES: CaptureCandidate[] = [
  ...SUPPORTED_AGENT_HOME_ARTIFACT_DIRS.map((dir): CaptureCandidate => ({
    kind: "agent-artifact",
    sourcePath: ({ home }) => posix.join(home, dir),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", dir),
    ensureDestinationDir: (stagingDir) => join(stagingDir, "artifacts"),
    reportMissing: false,
  })),
  {
    kind: "agent-artifact",
    sourcePath: ({ workspace }) => posix.join(workspace, "AGENTS.md"),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts", "AGENTS.md"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", "AGENTS.md"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "artifacts", "AGENTS.md")),
    reportMissing: true,
  },
  {
    kind: "agent-artifact",
    sourcePath: ({ workspace }) => posix.join(workspace, "MEMORY.md"),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts", "MEMORY.md"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", "MEMORY.md"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "artifacts", "MEMORY.md")),
    reportMissing: true,
  },
  {
    kind: "session-transcript",
    sourcePath: ({ workspace }) => posix.join(workspace, ".sheal", "session.jsonl"),
    copyDestination: (stagingDir) => join(stagingDir, "transcript", "session.jsonl"),
    stagedPath: (stagingDir) => join(stagingDir, "transcript", "session.jsonl"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "transcript", "session.jsonl")),
    reportMissing: true,
  },
];

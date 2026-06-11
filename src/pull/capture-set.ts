import { dirname, join, posix } from "node:path";
import type { PullArtifactKind } from "./types.js";

export interface CaptureCandidate {
  kind: PullArtifactKind;
  sourcePath(context: CaptureContext): string;
  copyDestination(stagingDir: string, context: CaptureContext): string;
  stagedPath(stagingDir: string, context: CaptureContext): string;
  ensureDestinationDir(stagingDir: string, context: CaptureContext): string;
}

export interface CaptureContext {
  workspace: string;
  home: string;
  agent: string;
}

export const ORDERED_CAPTURE_CANDIDATES: CaptureCandidate[] = [
  {
    kind: "agent-artifact",
    sourcePath: (context) => posix.join(context.home, agentHomeArtifactDir(context.agent)),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts"),
    stagedPath: (stagingDir, context) => join(stagingDir, "artifacts", agentHomeArtifactDir(context.agent)),
    ensureDestinationDir: (stagingDir) => join(stagingDir, "artifacts"),
  },
  {
    kind: "agent-artifact",
    sourcePath: ({ workspace }) => posix.join(workspace, "AGENTS.md"),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts", "AGENTS.md"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", "AGENTS.md"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "artifacts", "AGENTS.md")),
  },
  {
    kind: "agent-artifact",
    sourcePath: ({ workspace }) => posix.join(workspace, "MEMORY.md"),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts", "MEMORY.md"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", "MEMORY.md"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "artifacts", "MEMORY.md")),
  },
  {
    kind: "session-transcript",
    sourcePath: ({ workspace }) => posix.join(workspace, ".sheal", "session.jsonl"),
    copyDestination: (stagingDir) => join(stagingDir, "transcript", "session.jsonl"),
    stagedPath: (stagingDir) => join(stagingDir, "transcript", "session.jsonl"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "transcript", "session.jsonl")),
  },
];

function agentHomeArtifactDir(agent: string): string {
  switch (agent.toLowerCase()) {
    case "codex":
      return ".codex";
    default:
      return ".claude";
  }
}

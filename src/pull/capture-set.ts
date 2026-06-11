import { dirname, join, posix } from "node:path";
import type { PullArtifactKind } from "./types.js";

export interface CaptureCandidate {
  kind: PullArtifactKind;
  sourcePath(context: CaptureContext): string;
  copyDestination(stagingDir: string, context: CaptureContext): string;
  stagedPath(stagingDir: string, context: CaptureContext): string;
  ensureDestinationDir(stagingDir: string, context: CaptureContext): string;
  reportMissing(context: CaptureContext): boolean;
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
    reportMissing: () => false,
  })),
  {
    kind: "agent-artifact",
    sourcePath: ({ workspace }) => posix.join(workspace, "AGENTS.md"),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts", "AGENTS.md"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", "AGENTS.md"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "artifacts", "AGENTS.md")),
    reportMissing: () => true,
  },
  {
    kind: "agent-artifact",
    sourcePath: ({ workspace }) => posix.join(workspace, "MEMORY.md"),
    copyDestination: (stagingDir) => join(stagingDir, "artifacts", "MEMORY.md"),
    stagedPath: (stagingDir) => join(stagingDir, "artifacts", "MEMORY.md"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "artifacts", "MEMORY.md")),
    reportMissing: () => true,
  },
  {
    kind: "session-transcript",
    sourcePath: ({ home }) => posix.join(home, ".claude", "sessions.jsonl"),
    copyDestination: (stagingDir) => join(stagingDir, "transcript", ".claude", "sessions.jsonl"),
    stagedPath: (stagingDir) => join(stagingDir, "transcript", ".claude", "sessions.jsonl"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "transcript", ".claude", "sessions.jsonl")),
    reportMissing: () => false,
  },
  {
    kind: "session-transcript",
    sourcePath: ({ home }) => posix.join(home, ".claude", "history.jsonl"),
    copyDestination: (stagingDir) => join(stagingDir, "transcript", ".claude", "history.jsonl"),
    stagedPath: (stagingDir) => join(stagingDir, "transcript", ".claude", "history.jsonl"),
    ensureDestinationDir: (stagingDir) => dirname(join(stagingDir, "transcript", ".claude", "history.jsonl")),
    reportMissing: () => false,
  },
  {
    kind: "session-transcript",
    sourcePath: (context) => posix.join(context.home, ".claude", "projects", claudeProjectSlug(context.workspace)),
    copyDestination: (stagingDir) => join(stagingDir, "transcript", ".claude", "projects"),
    stagedPath: (stagingDir, context) => join(stagingDir, "transcript", ".claude", "projects", claudeProjectSlug(context.workspace)),
    ensureDestinationDir: (stagingDir) => join(stagingDir, "transcript", ".claude", "projects"),
    reportMissing: (context) => isAgent(context, "claude"),
  },
  {
    kind: "session-transcript",
    sourcePath: ({ home }) => posix.join(home, ".codex", "sessions"),
    copyDestination: (stagingDir) => join(stagingDir, "transcript", ".codex"),
    stagedPath: (stagingDir) => join(stagingDir, "transcript", ".codex", "sessions"),
    ensureDestinationDir: (stagingDir) => join(stagingDir, "transcript", ".codex"),
    reportMissing: (context) => isAgent(context, "codex"),
  },
];

function claudeProjectSlug(workspace: string): string {
  return workspace.replace(/[\\/: ]/g, "-");
}

function isAgent(context: CaptureContext, agent: string): boolean {
  const normalized = context.agent.toLowerCase().trim().replace(/\s+/g, "-");
  return normalized === agent || (agent === "claude" && normalized === "claude-code");
}

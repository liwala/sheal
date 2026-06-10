export interface SandboxInstance {
  backend: string;
  name: string;
  agent: string;
  status: string;
  workspaces: string[];
  workspaceMissing?: boolean;
}

export type PullArtifactKind = "git.diff" | "agent-artifact" | "session-transcript";

export interface PullArtifact {
  kind: PullArtifactKind;
  path: string;
  sourcePath: string;
}

export interface PullProvenance {
  backend: string;
  type: string;
  name: string;
  agent: string;
  status: string;
  pulledAt: string;
  sourcePaths: string[];
  gaps: string[];
}

export interface PullResult {
  artifacts: PullArtifact[];
  gaps: string[];
  provenance: PullProvenance;
}

export interface PullOptions {
  pulledAt?: string;
}

export interface SandboxAdapter {
  type: string;
  isAvailable(): Promise<boolean>;
  listInstances(): Promise<SandboxInstance[]>;
  pull(name: string, stagingDir: string, options?: PullOptions): Promise<PullResult>;
}

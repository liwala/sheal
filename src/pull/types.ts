export interface SandboxInstance {
  backend: string;
  name: string;
  agent: string;
  status: string;
  workspaces: string[];
  workspaceMissing?: boolean;
}

export interface PullArtifact {
  kind: "git.diff";
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

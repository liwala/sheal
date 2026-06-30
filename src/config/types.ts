export interface PullCheckpointTarget {
  backend: string;
  name: string;
}

export interface SelfHealConfig {
  skip?: string[];
  pull?: {
    stagingDir?: string;
    stagingRetentionDays?: number;
    checkpointTargets?: PullCheckpointTarget[];
  };
  checkers?: {
    git?: { allowDirty?: boolean };
    dependencies?: {
      ecosystems?: ("node" | "python" | "go" | "rust")[];
    };
    tests?: {
      command?: string;
      timeoutMs?: number;
    };
    environment?: {
      requiredVars?: string[];
      requiredServices?: { name: string; check: string }[];
    };
    sessionLearnings?: {
      files?: string[];
    };
  };
  learnings?: {
    tags?: string[];
  };
  timeoutMs?: number;
  format?: "pretty" | "json";
}

export interface ResolvedConfig {
  skip: string[];
  pull: {
    stagingDir: string | null;
    stagingRetentionDays: number | null;
    checkpointTargets: PullCheckpointTarget[];
  };
  checkers: {
    git: { allowDirty: boolean };
    dependencies: {
      ecosystems: ("node" | "python" | "go" | "rust")[];
    };
    tests: {
      command: string | null;
      timeoutMs: number;
    };
    environment: {
      requiredVars: string[];
      requiredServices: { name: string; check: string }[];
    };
    sessionLearnings: {
      files: string[];
    };
  };
  learnings: {
    tags: string[];
  };
  timeoutMs: number;
  format: "pretty" | "json";
}

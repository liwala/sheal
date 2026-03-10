export interface SelfHealConfig {
  skip?: string[];
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
  timeoutMs?: number;
  format?: "pretty" | "json";
}

export interface ResolvedConfig {
  skip: string[];
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
  timeoutMs: number;
  format: "pretty" | "json";
}

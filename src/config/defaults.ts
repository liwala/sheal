import type { ResolvedConfig } from "./types.js";

export const defaultConfig: ResolvedConfig = {
  skip: [],
  checkers: {
    git: { allowDirty: false },
    dependencies: { ecosystems: [] }, // empty = auto-detect
    tests: { command: null, timeoutMs: 15_000 },
    environment: { requiredVars: [], requiredServices: [] },
    sessionLearnings: { files: [] },
  },
  timeoutMs: 30_000,
  format: "pretty",
};

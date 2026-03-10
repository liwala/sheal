import type { ResolvedConfig } from "../config/types.js";

export type Severity = "pass" | "warn" | "fail" | "skip";

export interface CheckDetail {
  message: string;
  severity: Severity;
  data?: Record<string, unknown>;
}

export interface CheckResult {
  name: string;
  label: string;
  severity: Severity;
  details: CheckDetail[];
  durationMs: number;
}

export interface CheckerContext {
  projectRoot: string;
  config: ResolvedConfig;
}

export interface Checker {
  name: string;
  label: string;
  run(ctx: CheckerContext): Promise<CheckResult>;
}

export type { ResolvedConfig };

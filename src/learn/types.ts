/**
 * Categories for learnings — reuses the same categories from the retro system.
 */
export type LearningCategory =
  | "missing-context"
  | "failure-loop"
  | "wasted-effort"
  | "environment"
  | "workflow";

export type LearningSeverity = "low" | "medium" | "high";

export type LearningStatus = "active" | "superseded" | "retired";

/**
 * A structured learning stored as an ADR-style markdown file.
 */
export interface LearningFile {
  /** Sequential ID, e.g. "LEARN-001" */
  id: string;
  /** Short descriptive title */
  title: string;
  /** Date the learning was recorded (YYYY-MM-DD) */
  date: string;
  /** Tags for filtering and project matching */
  tags: string[];
  /** What kind of issue this learning addresses */
  category: LearningCategory;
  /** How impactful the issue was */
  severity: LearningSeverity;
  /** Whether this learning is still relevant */
  status: LearningStatus;
  /** The learning content (markdown body) */
  body: string;
}

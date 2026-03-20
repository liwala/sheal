/**
 * Amp-specific retrospective analysis.
 *
 * Builds a Retrospective from Amp file-change data (no conversation transcripts).
 * Leverages Amp's native `reverted` tracking for better revert detection.
 */

import type { AmpFileChange } from "../entire/amp-native.js";
import type { Retrospective, EffortBreakdown, RevertedWork, Learning } from "./types.js";

/**
 * Run a retrospective on an Amp thread's file changes.
 */
export function runAmpRetrospective(
  threadId: string,
  files: AmpFileChange[],
): Retrospective {
  const effort = analyzeAmpEffort(files);
  const revertedWork = detectAmpReverts(files);
  const learnings = extractAmpLearnings(effort, revertedWork, files);
  const healthScore = calculateAmpHealthScore(revertedWork, effort, files);

  const earliest = files.length > 0
    ? new Date(Math.min(...files.map((f) => f.timestamp))).toISOString()
    : "";

  return {
    checkpointId: threadId,
    sessionId: threadId,
    agent: "Amp",
    createdAt: earliest,
    effort,
    failureLoops: [], // No conversation data to detect loops
    revertedWork,
    learnings,
    healthScore,
  };
}

function analyzeAmpEffort(files: AmpFileChange[]): EffortBreakdown {
  const fileTouchCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = { "file-write": 0 };

  for (const f of files) {
    // Use relative-ish path (last 3 segments) for readability
    const shortPath = f.filePath.split("/").slice(-3).join("/");
    fileTouchCounts[shortPath] = (fileTouchCounts[shortPath] || 0) + 1;
    toolCounts["file-write"]++;
  }

  return {
    entryCounts: {
      "file-change": files.length,
      "new-file": files.filter((f) => f.isNewFile).length,
      "reverted": files.filter((f) => f.reverted).length,
    },
    toolCounts,
    fileTouchCounts,
    userPromptCount: 0, // No conversation data
    assistantResponseCount: 0,
  };
}

function detectAmpReverts(files: AmpFileChange[]): RevertedWork[] {
  // Amp natively tracks reverted files — use that directly
  const reverted = files.filter((f) => f.reverted);
  if (reverted.length === 0) return [];

  return [{
    files: reverted.map((f) => f.filePath),
    wastedOperations: reverted.length,
  }];
}

function extractAmpLearnings(
  effort: EffortBreakdown,
  revertedWork: RevertedWork[],
  files: AmpFileChange[],
): Learning[] {
  const learnings: Learning[] = [];
  let id = 1;

  // Reverted work
  const revertedCount = files.filter((f) => f.reverted).length;
  if (revertedCount > 0) {
    const ratio = revertedCount / files.length;
    learnings.push({
      id: `L${id++}`,
      category: "wasted-effort",
      severity: ratio > 0.3 ? "high" : revertedCount >= 3 ? "medium" : "low",
      description: `${revertedCount} of ${files.length} file changes were reverted (${(ratio * 100).toFixed(0)}%)`,
      suggestion: "High revert rate suggests exploration or false starts. Consider planning before writing.",
      evidence: files.filter((f) => f.reverted).map((f) => f.filePath.split("/").pop() || ""),
    });
  }

  // File churn (same file changed multiple times)
  const hotFiles = Object.entries(effort.fileTouchCounts)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (hotFiles.length > 0) {
    learnings.push({
      id: `L${id++}`,
      category: "workflow",
      severity: hotFiles.some(([_, c]) => c >= 5) ? "medium" : "low",
      description: `File churn detected: ${hotFiles.map(([f, c]) => `${f.split("/").pop()} (${c}x)`).join(", ")}`,
      suggestion: "Consider planning changes to frequently-modified files upfront",
    });
  }

  // Large session (many file changes)
  if (files.length > 30) {
    learnings.push({
      id: `L${id++}`,
      category: "workflow",
      severity: "low",
      description: `Large session: ${files.length} file changes`,
      suggestion: "Consider breaking large sessions into smaller, focused tasks",
    });
  }

  // Session duration
  if (files.length >= 2) {
    const earliest = Math.min(...files.map((f) => f.timestamp));
    const latest = Math.max(...files.map((f) => f.timestamp));
    const durationMin = (latest - earliest) / 60000;
    if (durationMin > 60) {
      learnings.push({
        id: `L${id++}`,
        category: "workflow",
        severity: "low",
        description: `Long session: ${Math.round(durationMin)} minutes`,
        suggestion: "Consider committing incrementally during long sessions",
      });
    }
  }

  return learnings;
}

function calculateAmpHealthScore(
  revertedWork: RevertedWork[],
  effort: EffortBreakdown,
  files: AmpFileChange[],
): number {
  let score = 100;

  // Deduct for reverted work
  const revertedCount = files.filter((f) => f.reverted).length;
  const revertRatio = files.length > 0 ? revertedCount / files.length : 0;
  score -= Math.min(30, Math.round(revertRatio * 50));

  // Deduct for excessive file churn
  const maxTouches = Math.max(0, ...Object.values(effort.fileTouchCounts));
  if (maxTouches > 5) score -= 5;
  if (maxTouches > 8) score -= 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Session Retrospective Engine.
 *
 * Takes a loaded checkpoint/session and produces a full retrospective report.
 */

import type { Checkpoint } from "../entire/types.js";
import type { Retrospective } from "./types.js";
import {
  analyzeEffort,
  analyzeHumanPatterns,
  detectFailureLoops,
  detectRevertedWork,
  detectBashFailures,
  extractLearnings,
  calculateHealthScore,
  detectCoordinationIssues,
} from "./analyzers.js";

/**
 * Run a full retrospective analysis on a checkpoint.
 * Analyzes the first session by default (most checkpoints have one session).
 */
export function runRetrospective(
  checkpoint: Checkpoint,
  sessionIndex = 0,
): Retrospective {
  const session = checkpoint.sessions[sessionIndex];
  if (!session) {
    throw new Error(`Session index ${sessionIndex} not found in checkpoint ${checkpoint.root.checkpointId}`);
  }

  const effort = analyzeEffort(session);
  const humanPatterns = analyzeHumanPatterns(session);
  const failureLoops = detectFailureLoops(session);
  const revertedWork = detectRevertedWork(session);
  const bashFailures = detectBashFailures(session);
  const learnings = extractLearnings(effort, failureLoops, revertedWork, bashFailures);
  const healthScore = calculateHealthScore(failureLoops, revertedWork, bashFailures, effort);
  const coordinationIssues = detectCoordinationIssues(checkpoint);

  return {
    checkpointId: checkpoint.root.checkpointId,
    sessionId: session.metadata.sessionId,
    agent: session.metadata.agent,
    createdAt: session.metadata.createdAt,
    entireSummary: session.metadata.summary,
    effort,
    failureLoops,
    revertedWork,
    learnings,
    healthScore,
    humanPatterns,
    ...(coordinationIssues.length > 0 ? { coordinationIssues } : {}),
  };
}

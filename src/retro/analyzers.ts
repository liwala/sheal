/**
 * Session analysis functions that detect patterns in transcript data.
 */

import type { Session, SessionEntry, Checkpoint } from "@liwala/agent-sessions";
import type { EffortBreakdown, FailureLoop, RevertedWork, Learning, HumanPatterns, CoordinationIssue } from "./types.js";

/**
 * Build an effort breakdown from session transcript.
 */
export function analyzeEffort(session: Session): EffortBreakdown {
  const entries = session.transcript;
  const entryCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  const fileTouchCounts: Record<string, number> = {};

  for (const entry of entries) {
    entryCounts[entry.type] = (entryCounts[entry.type] || 0) + 1;

    if (entry.toolName) {
      toolCounts[entry.toolName] = (toolCounts[entry.toolName] || 0) + 1;
    }

    for (const file of entry.filesAffected ?? []) {
      fileTouchCounts[file] = (fileTouchCounts[file] || 0) + 1;
    }
  }

  return {
    entryCounts,
    toolCounts,
    fileTouchCounts,
    userPromptCount: entries.filter((e) => e.type === "user").length,
    assistantResponseCount: entries.filter((e) => e.type === "assistant").length,
    tokenUsage: session.metadata.tokenUsage,
  };
}

/**
 * Detect failure loops: same action retried multiple times in sequence.
 *
 * For file-modifying tools (Write, Edit): groups by tool+file.
 * For Bash: groups by the base command (first word), since different Bash calls
 * to entirely different commands are NOT retries.
 * Requires at least 3 consecutive same-action calls to count as a loop,
 * AND at least one error in the sequence (to distinguish from productive batches).
 */
export function detectFailureLoops(session: Session): FailureLoop[] {
  const entries = session.transcript;
  const loops: FailureLoop[] = [];

  let currentRun: { key: string; label: string; entries: typeof entries; errors: string[] } | null = null;

  for (const entry of entries) {
    if (entry.type === "tool" && entry.toolName) {
      const key = getActionKey(entry);
      const label = getActionLabel(entry);

      if (currentRun && currentRun.key === key) {
        currentRun.entries.push(entry);
      } else {
        flushRun(currentRun, loops);
        currentRun = { key, label, entries: [entry], errors: [] };
      }
    } else if (entry.type === "tool" && entry.toolOutput && currentRun) {
      const output = typeof entry.toolOutput === "string" ? entry.toolOutput : JSON.stringify(entry.toolOutput);
      if (output.toLowerCase().includes("error") || output.includes("Exit code 1")) {
        currentRun.errors.push(output.slice(0, 200));
      }
    }
  }

  flushRun(currentRun, loops);
  return loops;
}

function getActionKey(entry: SessionEntry): string {
  const toolName = entry.toolName ?? "";

  // For Bash, use the base command as the key
  if (toolName === "Bash") {
    const input = entry.toolInput as Record<string, unknown> | undefined;
    const command = (input?.command as string) ?? "";
    // Use the full command (trimmed to 80 chars) as key so only truly identical
    // commands are grouped. Different bd/git/npm commands are distinct actions.
    const normalized = command.trim().split("&&")[0].trim().split("|")[0].trim().slice(0, 80);
    return `Bash:${normalized}`;
  }

  // For file tools, group by tool + file
  const file = entry.filesAffected?.[0] ?? "";
  return `${toolName}:${file}`;
}

function getActionLabel(entry: SessionEntry): string {
  const toolName = entry.toolName ?? "";
  if (toolName === "Bash") {
    const input = entry.toolInput as Record<string, unknown> | undefined;
    const command = (input?.command as string) ?? "unknown";
    return `Bash: ${command.slice(0, 80)}`;
  }
  const file = entry.filesAffected?.[0]?.split("/").pop() ?? "";
  return file ? `${toolName} on ${file}` : toolName;
}

function flushRun(
  run: { key: string; label: string; entries: SessionEntry[]; errors: string[] } | null,
  loops: FailureLoop[],
): void {
  // Only count as a loop if: 3+ retries AND at least one error detected
  if (run && run.entries.length >= 3 && run.errors.length > 0) {
    loops.push({
      action: run.label,
      retryCount: run.entries.length,
      entries: run.entries,
      errorPattern: run.errors[0] ?? "repeated attempts",
    });
  }
}

/**
 * Detect reverted work: files that were written/edited and then written again
 * with content that suggests the earlier work was discarded.
 */
export function detectRevertedWork(session: Session): RevertedWork[] {
  const entries = session.transcript;
  const fileWriteHistory: Record<string, number> = {};
  const reverted: RevertedWork[] = [];

  for (const entry of entries) {
    if (entry.toolName && ["Write", "Edit"].includes(entry.toolName)) {
      for (const file of entry.filesAffected ?? []) {
        fileWriteHistory[file] = (fileWriteHistory[file] || 0) + 1;
      }
    }
  }

  // Files written 4+ times suggest churn (write, fix, fix, fix...)
  const churnedFiles = Object.entries(fileWriteHistory)
    .filter(([_, count]) => count >= 4)
    .map(([file, count]) => ({ file, count }));

  if (churnedFiles.length > 0) {
    reverted.push({
      files: churnedFiles.map((f) => f.file),
      wastedOperations: churnedFiles.reduce((sum, f) => sum + f.count - 1, 0),
    });
  }

  return reverted;
}

/**
 * Detect Bash command failures (exit code != 0 patterns in tool outputs).
 */
export function detectBashFailures(session: Session): { command: string; error: string }[] {
  const entries = session.transcript;
  const failures: { command: string; error: string }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.toolName === "Bash" && entry.toolInput) {
      const input = entry.toolInput as Record<string, unknown>;
      const command = (input.command as string) ?? "";

      // Look at the next few entries for error output
      for (let j = i + 1; j < Math.min(i + 3, entries.length); j++) {
        const result = entries[j];
        if (result.type === "tool" && result.toolOutput) {
          const output = typeof result.toolOutput === "string" ? result.toolOutput : JSON.stringify(result.toolOutput);
          if (output.includes("Exit code 1") || output.includes("Error:") || output.includes("error:")) {
            failures.push({
              command: command.slice(0, 100),
              error: output.slice(0, 200),
            });
            break;
          }
        }
      }
    }
  }

  return failures;
}

/**
 * Extract learnings from all analysis results.
 */
export function extractLearnings(
  effort: EffortBreakdown,
  failureLoops: FailureLoop[],
  revertedWork: RevertedWork[],
  bashFailures: { command: string; error: string }[],
): Learning[] {
  const learnings: Learning[] = [];
  let id = 1;

  // Failure loop learnings
  for (const loop of failureLoops) {
    learnings.push({
      id: `L${id++}`,
      category: "failure-loop",
      severity: loop.retryCount >= 5 ? "high" : "medium",
      description: `Retried "${loop.action}" ${loop.retryCount} times`,
      suggestion: `Add a pre-check or validation before attempting ${loop.action}. Consider: is the approach fundamentally wrong?`,
      evidence: [loop.errorPattern],
    });
  }

  // Reverted work learnings
  for (const rw of revertedWork) {
    learnings.push({
      id: `L${id++}`,
      category: "wasted-effort",
      severity: rw.wastedOperations >= 6 ? "high" : "medium",
      description: `${rw.files.length} file(s) had excessive churn (${rw.wastedOperations} extra operations)`,
      suggestion: `Plan changes before editing. Files with churn: ${rw.files.map((f) => f.split("/").pop()).join(", ")}`,
      evidence: rw.files,
    });
  }

  // Bash failure patterns
  if (bashFailures.length >= 3) {
    learnings.push({
      id: `L${id++}`,
      category: "environment",
      severity: bashFailures.length >= 5 ? "high" : "medium",
      description: `${bashFailures.length} Bash commands failed during the session`,
      suggestion: "Run 'sheal check' before starting to catch environment issues early",
      evidence: bashFailures.slice(0, 3).map((f) => f.command),
    });
  }

  // Heavy file modification patterns
  const hotFiles = Object.entries(effort.fileTouchCounts)
    .filter(([_, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1]);

  if (hotFiles.length > 0) {
    learnings.push({
      id: `L${id++}`,
      category: "workflow",
      severity: "low",
      description: `Hot files touched many times: ${hotFiles.map(([f, c]) => `${f.split("/").pop()} (${c}x)`).join(", ")}`,
      suggestion: "Consider planning changes to these files upfront to reduce iteration",
    });
  }

  // High tool-to-prompt ratio (agent doing lots of work per prompt)
  const totalTools = Object.values(effort.toolCounts).reduce((a, b) => a + b, 0);
  if (effort.userPromptCount > 0 && totalTools / effort.userPromptCount > 25) {
    learnings.push({
      id: `L${id++}`,
      category: "workflow",
      severity: "low",
      description: `High tool-to-prompt ratio: ${(totalTools / effort.userPromptCount).toFixed(0)} tools per prompt`,
      suggestion: "Session was efficient — agent handled complex tasks with minimal guidance",
    });
  }

  return learnings;
}

/**
 * Analyze human interaction patterns from the transcript.
 */
export function analyzeHumanPatterns(session: Session): HumanPatterns {
  const entries = session.transcript;
  const userEntries = entries.filter((e) => e.type === "user");

  // Duration: estimate from entry positions (timestamps not always available)
  // Use token usage API call count as a proxy for time if timestamps unavailable
  const tokenUsage = session.metadata.tokenUsage;
  // Rough estimate: ~30 seconds per API call, or use entry count as proxy
  const estimatedMinutes = tokenUsage
    ? Math.round(tokenUsage.apiCallCount * 0.5)
    : Math.round(entries.length * 0.15);

  // Average interval between prompts
  const avgPromptInterval = userEntries.length > 1
    ? estimatedMinutes / userEntries.length
    : estimatedMinutes;

  // Corrections: user redirecting the agent
  const correctionPatterns = /^(no[,.\s]|not that|instead[,\s]|wrong|stop|don'?t|actually[,\s]|wait[,\s]|I said|I meant|that'?s not|let'?s not)/i;
  const correctionCount = userEntries.filter((e) =>
    correctionPatterns.test(e.content.trim()),
  ).length;

  // Prompt length analysis
  const shortPromptCount = userEntries.filter((e) => e.content.trim().length < 20).length;
  const longPromptCount = userEntries.filter((e) => e.content.trim().length > 500).length;

  // Context compaction detection (system messages about compaction/summary)
  const contextCompacted = entries.some((e) =>
    e.type === "system" && (
      e.content.includes("compaction") ||
      e.content.includes("compressed") ||
      e.content.includes("context limit") ||
      e.content.includes("being continued from a previous conversation")
    ),
  ) || entries.some((e) =>
    e.type === "user" && e.content.includes("being continued from a previous conversation"),
  );

  // Engagement: how much of the transcript is human input
  const humanEngagementRatio = entries.length > 0
    ? userEntries.length / entries.length
    : 0;

  return {
    durationMinutes: estimatedMinutes,
    avgPromptIntervalMinutes: Math.round(avgPromptInterval * 10) / 10,
    correctionCount,
    shortPromptCount,
    longPromptCount,
    contextCompacted,
    humanEngagementRatio: Math.round(humanEngagementRatio * 1000) / 1000,
  };
}

/**
 * Calculate a health score (0-100) for the session.
 * Higher = healthier (fewer issues).
 */
export function calculateHealthScore(
  failureLoops: FailureLoop[],
  revertedWork: RevertedWork[],
  bashFailures: { command: string; error: string }[],
  effort: EffortBreakdown,
): number {
  let score = 100;

  // Deduct for failure loops (only real ones matter)
  for (const loop of failureLoops) {
    score -= Math.min(10, loop.retryCount * 2);
  }

  // Deduct for reverted work
  for (const rw of revertedWork) {
    score -= Math.min(10, rw.wastedOperations);
  }

  // Deduct for bash failures (mild — some failures are normal during development)
  score -= Math.min(10, Math.floor(bashFailures.length / 2));

  // Deduct for excessive file churn
  const maxTouches = Math.max(0, ...Object.values(effort.fileTouchCounts));
  if (maxTouches > 8) score -= 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Detect coordination issues across multiple sessions in a checkpoint.
 * Returns empty array if there's only one session.
 */
export function detectCoordinationIssues(checkpoint: Checkpoint): CoordinationIssue[] {
  const sessions = checkpoint.sessions;
  if (sessions.length < 2) return [];

  const issues: CoordinationIssue[] = [];

  // Build per-session file touch maps
  const sessionFiles: Array<{
    sessionId: string;
    agent: string;
    files: Set<string>;
    writeFiles: Set<string>;
  }> = sessions.map((s) => {
    const files = new Set<string>(s.metadata.filesTouched ?? []);
    const writeFiles = new Set<string>();
    for (const entry of s.transcript) {
      if (entry.toolName && ["Write", "Edit"].includes(entry.toolName)) {
        for (const f of entry.filesAffected ?? []) {
          writeFiles.add(f);
        }
      }
    }
    return {
      sessionId: s.metadata.sessionId,
      agent: s.metadata.agent ?? "unknown",
      files,
      writeFiles,
    };
  });

  // Detect conflicting edits: multiple sessions writing to the same files
  for (let i = 0; i < sessionFiles.length; i++) {
    for (let j = i + 1; j < sessionFiles.length; j++) {
      const a = sessionFiles[i];
      const b = sessionFiles[j];
      const sharedWrites = [...a.writeFiles].filter((f) => b.writeFiles.has(f));
      if (sharedWrites.length > 0) {
        issues.push({
          type: "conflicting-edits",
          description: `${a.agent} and ${b.agent} both wrote to ${sharedWrites.length} shared file(s): ${sharedWrites.map((f) => f.split("/").pop()).join(", ")}`,
          severity: sharedWrites.length >= 3 ? "high" : "medium",
          sessionIds: [a.sessionId, b.sessionId],
          agents: [a.agent, b.agent],
          files: sharedWrites,
        });
      }
    }
  }

  // Detect duplicated work: sessions with high file overlap but no shared writes
  // (suggests parallel work on same area without coordination)
  for (let i = 0; i < sessionFiles.length; i++) {
    for (let j = i + 1; j < sessionFiles.length; j++) {
      const a = sessionFiles[i];
      const b = sessionFiles[j];
      const sharedReads = [...a.files].filter((f) => b.files.has(f));
      const sharedWrites = [...a.writeFiles].filter((f) => b.writeFiles.has(f));
      // High read overlap without write conflicts suggests duplicated exploration
      if (sharedReads.length >= 5 && sharedWrites.length === 0) {
        issues.push({
          type: "duplicated-work",
          description: `${a.agent} and ${b.agent} explored ${sharedReads.length} of the same files — possible duplicated investigation`,
          severity: "low",
          sessionIds: [a.sessionId, b.sessionId],
          agents: [a.agent, b.agent],
          files: sharedReads,
        });
      }
    }
  }

  // Detect missed handoffs: session that ends with errors and next session
  // touches the same files (suggests first session should have handed off earlier)
  for (let i = 0; i < sessions.length - 1; i++) {
    const current = sessions[i];
    const next = sessions[i + 1];
    const currentFails = detectBashFailures(current);
    const currentReverts = detectRevertedWork(current);

    if (currentFails.length >= 3 || currentReverts.length > 0) {
      const currentFiles = sessionFiles[i].writeFiles;
      const nextFiles = sessionFiles[i + 1].writeFiles;
      const overlap = [...currentFiles].filter((f) => nextFiles.has(f));

      if (overlap.length > 0) {
        issues.push({
          type: "missed-handoff",
          description: `Session ${sessionFiles[i].agent} struggled (${currentFails.length} failures, ${currentReverts.reduce((s, r) => s + r.wastedOperations, 0)} wasted ops) then ${sessionFiles[i + 1].agent} reworked ${overlap.length} of the same files`,
          severity: currentFails.length >= 5 ? "high" : "medium",
          sessionIds: [current.metadata.sessionId, next.metadata.sessionId],
          agents: [sessionFiles[i].agent, sessionFiles[i + 1].agent],
          files: overlap,
        });
      }
    }
  }

  return issues;
}

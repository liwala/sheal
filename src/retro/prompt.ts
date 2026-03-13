/**
 * Generates an LLM prompt for deep session retrospective analysis.
 *
 * This is agent-agnostic — any LLM can be given this prompt along with
 * the static analysis data to produce a deep retrospective.
 */

import type { Retrospective } from "./types.js";
import type { Checkpoint } from "../entire/types.js";
import type { LearningFile } from "../learn/types.js";

/**
 * Generate a prompt for LLM-powered deep retrospective analysis.
 * Returns a structured prompt that any LLM can use.
 */
export function generateRetroPrompt(
  retro: Retrospective,
  checkpoint: Checkpoint,
  existingLearnings?: LearningFile[],
): string {
  const session = checkpoint.sessions[0];
  const userMessages = session?.transcript
    .filter((e) => e.type === "user")
    .map((e) => e.content.slice(0, 300))
    ?? [];

  const toolErrors = session?.transcript
    .filter((e) => e.type === "tool" && e.toolOutput)
    .filter((e) => {
      const out = typeof e.toolOutput === "string" ? e.toolOutput : JSON.stringify(e.toolOutput);
      return out.includes("Error") || out.includes("Exit code 1");
    })
    .map((e) => ({
      tool: e.toolName ?? "unknown",
      error: (typeof e.toolOutput === "string" ? e.toolOutput : JSON.stringify(e.toolOutput)).slice(0, 200),
    }))
    .slice(0, 15)
    ?? [];

  const entireSummary = retro.entireSummary
    ? `
## Entire.io AI Summary
- Intent: ${retro.entireSummary.intent}
- Outcome: ${retro.entireSummary.outcome}
- Friction: ${retro.entireSummary.friction.join("; ") || "none reported"}
- Learnings: ${[...retro.entireSummary.learnings.repo, ...retro.entireSummary.learnings.workflow].join("; ") || "none"}
- Open Items: ${retro.entireSummary.openItems.join("; ") || "none"}
`
    : "";

  return `You are performing a deep retrospective analysis of a completed AI coding session.
Your goal is to extract actionable learnings that will improve future sessions.

## Session Data

- Checkpoint: ${retro.checkpointId}
- Agent: ${retro.agent ?? "unknown"}
- Health Score: ${retro.healthScore}/100
- User Prompts: ${retro.effort.userPromptCount}
- Assistant Responses: ${retro.effort.assistantResponseCount}
- Files Modified: ${Object.keys(retro.effort.fileTouchCounts).length}
- Tools Used: ${Object.entries(retro.effort.toolCounts).map(([t, c]) => `${t}(${c})`).join(", ")}
${retro.effort.tokenUsage ? `- Tokens: ${retro.effort.tokenUsage.inputTokens} in / ${retro.effort.tokenUsage.outputTokens} out (${retro.effort.tokenUsage.apiCallCount} API calls)` : ""}
${entireSummary}
## User Prompts (what the user asked)
${userMessages.map((m, i) => `${i + 1}. ${m}`).join("\n")}

## Failure Loops Detected (${retro.failureLoops.length})
${retro.failureLoops.map((l) => `- ${l.action}: ${l.retryCount} retries. Error: ${l.errorPattern.slice(0, 150)}`).join("\n") || "None"}

## Reverted/Churned Work (${retro.revertedWork.length})
${retro.revertedWork.map((r) => `- ${r.files.map((f) => f.split("/").pop()).join(", ")}: ${r.wastedOperations} extra operations`).join("\n") || "None"}

## Tool Errors (${toolErrors.length} shown)
${toolErrors.map((e) => `- ${e.tool}: ${e.error}`).join("\n") || "None"}

## Most-Touched Files
${Object.entries(retro.effort.fileTouchCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, c]) => `- ${f.split("/").pop()} (${c}x)`).join("\n")}

## Static Analysis Learnings
${retro.learnings.map((l) => `- [${l.severity}/${l.category}] ${l.description} → ${l.suggestion}`).join("\n") || "None"}

## Existing Learnings (already captured)
${existingLearnings && existingLearnings.length > 0
    ? existingLearnings.map((l) => `- ${l.id} [${l.category}] ${l.title}`).join("\n")
    : "None yet"}

---

## Your Task

Be concise. Respond with ONLY this structure, no preamble:

**Summary:** 1-2 sentences on what happened and how it went.

**Top Issues:**
For each (max 3), one line: issue → root cause → fix. Skip one-off problems.

**Recurring:** Flag any issues that match or relate to existing learnings above. If the same mistake keeps happening, say so and suggest why the existing rule isn't working. If nothing recurs, write "None".

**Rules:** 3-5 new rules (not duplicating existing learnings above). Format each as a bullet starting with "- ".
Each rule must be a direct instruction to a future AI agent. Be specific and actionable — not "be more careful" but "run X before doing Y".
Only include rules for issues likely to recur.`;
}

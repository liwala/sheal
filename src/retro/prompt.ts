/**
 * Generates an LLM prompt for deep session retrospective analysis.
 *
 * This is agent-agnostic — any LLM can be given this prompt along with
 * the static analysis data to produce a deep retrospective.
 */

import type { Retrospective } from "./types.js";
import type { Checkpoint } from "../entire/types.js";

/**
 * Generate a prompt for LLM-powered deep retrospective analysis.
 * Returns a structured prompt that any LLM can use.
 */
export function generateRetroPrompt(
  retro: Retrospective,
  checkpoint: Checkpoint,
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

---

## Your Task

Analyze this session and produce:

1. **Summary**: What happened in this session? (1-2 sentences)
2. **What Went Well**: List things that were productive and effective
3. **What Could Be Improved**: For each issue, explain WHY it happened and WHAT to do differently
4. **Suggested Rules**: Write 3-5 specific, actionable rules that should be added to the project's agent config file (CLAUDE.md, .cursorrules, AGENTS.md). Rules should be:
   - Phrased as instructions to a future AI agent
   - Specific enough to be actionable (not "be more careful")
   - Only for issues likely to recur (skip one-off problems)

Format as markdown.`;
}

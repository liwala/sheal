---
name: retro
description: Run a deep session retrospective analyzing the most recent AI coding session. Uses Entire.io session data + static analysis, then the agent reviews its own work to extract learnings and generate rules.
allowed-tools: Bash(sheal *), Bash(git *), Bash(npx *), Read, Write, Edit, Glob, Grep
argument-hint: [checkpoint-id]
---

# Session Retrospective Skill

You are performing a deep retrospective analysis of a completed AI coding session. This is the self-healing loop: you're reviewing what happened and generating actionable rules to improve future sessions.

## Step 1: Gather Data

Run the static analysis first. If a checkpoint ID was provided as an argument, use it. Otherwise, use the latest checkpoint.

```bash
sheal retro --format json [-c CHECKPOINT_ID]
```

Also load the session details to see the Entire.io summary:

```bash
sheal sessions --format json [-c CHECKPOINT_ID]
```

## Step 2: Deep Analysis

With the static analysis and session data loaded, analyze the session deeply. Consider:

### Failure Patterns
- For each failure loop or Bash failure: **why** did it happen? Was it a wrong approach, missing context, environment issue, or normal iteration?
- Could a pre-check have prevented it?
- Was the agent stuck or making progress?

### Effort Quality
- Was the file churn productive iteration or wasted effort?
- Were the right tools used? (e.g., using Bash when Read/Grep would have been better)
- Was research done before implementation, or was the approach trial-and-error?

### Missing Context
- What information was missing at the start that caused problems later?
- What should have been in CLAUDE.md, .cursorrules, or project documentation?
- Were there assumptions that turned out wrong?

### Workflow Improvements
- What would make the next session smoother?
- Are there recurring patterns that should become rules?
- Should any health checks be added to `sheal check`?

## Step 3: Generate Output

Present your analysis as a structured retrospective report:

### Report Format

```
## Session Retrospective: [checkpoint-id]

### Summary
[1-2 sentence summary of what happened and how it went]

### Health Score: [X/100]
[Explain why this score, what went well, what didn't]

### Key Findings

#### What Went Well
- [thing 1]
- [thing 2]

#### What Could Be Improved
- [issue 1]: [why it happened] → [what to do differently]
- [issue 2]: [why it happened] → [what to do differently]

### Suggested Rules
[List specific rules that should be added to agent config files]
```

## Step 4: Apply Learnings (with user confirmation)

After presenting the report, ask the user if they want to apply any of the suggested rules. If yes:

1. For Claude Code: append rules to `CLAUDE.md` in the project root
2. For Cursor: append to `.cursorrules`
3. For Gemini: append to `.gemini/GEMINI.md`
4. For general: append to `AGENTS.md`

Format rules as clear, actionable instructions. For example:

```markdown
## Learnings from session [date]

- Before writing parsers for external data formats, inspect real data samples first (`git show branch:path/to/file | head -20`). Don't assume formats from documentation alone.
- When a CLI tool fails with "connection refused", check if its required server process is running before retrying the same command.
- Run `sheal check` at session start to catch environment issues early.
```

## Important Notes

- Be honest about what went well — not every session has problems
- Focus on actionable, specific learnings, not generic advice
- Rules should be phrased as instructions to a future AI agent
- Don't generate rules for one-off issues that won't recur
- Consider whether the issue is project-specific or universal

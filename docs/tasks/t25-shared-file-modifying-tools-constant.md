---
status: todo
type: task
id: T25
deliverable: P0
created: 2026-07-17
links:
  - https://github.com/liwala/sheal/pull/49
---

# T25. Share the file-modifying-tools list between agent-sessions and retro completeness

## Objective

`FILE_MODIFYING_TOOLS` in `src/retro/completeness.ts` (Edit, Write,
MultiEdit, NotebookEdit) disagrees with agent-sessions' own file-tools
knowledge (`packages/agent-sessions/src/transcript.ts:359`): Gemini
display-named tools and `mcp__acp__Write`/`mcp__acp__Edit` never trigger
the filesTouched gap — false negatives only, but the two lists will keep
drifting. Found by the pr-tutor pass on PR #49.

## What we need to extract / do

- Export a single file-modifying-tools predicate/constant from
  `@liwala/agent-sessions` and consume it in `src/retro/completeness.ts`.
- Parity test locking the invariant: the completeness module recognizes
  every tool name the transcript layer classifies as file-modifying
  (cross-surface agreement must be tested, not coincidental).

## Done when

- One source of truth; red-first parity test; a Gemini-named or
  mcp__acp__ write tool with empty filesTouched now yields the gap.

## Output

packages/agent-sessions/src/transcript.ts (export), src/retro/completeness.ts, tests.

## Dependencies

T22 merged (PR #49).

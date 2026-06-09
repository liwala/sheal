# Claude Code Instructions

See @AGENTS.md for general agent instructions and session learnings.

## Project-Specific

- This is the `sheal` (self-healing) CLI toolkit — TypeScript, Node.js
- Build: `npx tsc` — always rebuild before testing `sheal` commands
- Test: `npx vitest run`
- The CLI is globally linked via `npm link` — rebuild dist/ after changes

## Skills

- `/retro [checkpoint-id]` — Run a deep session retrospective with LLM analysis

## Task and question tracking

This project uses `docs/tasks/` to track work items and open decisions. Use the `/opentasks` skill to manage it.

- When planning or breaking down work, record concrete steps as tasks (`/opentasks new task <title>`) and open decisions as questions (`/opentasks new question <title>`).
- Keep status current: mark items `doing` when you start, `blocked` when waiting, `done` when complete.
- Never create task or question files manually — always go through `/opentasks` to keep the index in sync.

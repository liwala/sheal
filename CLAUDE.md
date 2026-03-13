# Claude Code Instructions

See @AGENTS.md for general agent instructions and session learnings.

## Project-Specific

- This is the `sheal` (self-healing) CLI toolkit — TypeScript, Node.js
- Build: `npx tsc` — always rebuild before testing `sheal` commands
- Test: `npx vitest run`
- The CLI is globally linked via `npm link` — rebuild dist/ after changes

## Skills

- `/retro [checkpoint-id]` — Run a deep session retrospective with LLM analysis

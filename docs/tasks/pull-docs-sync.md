---
status: todo
type: task
deliverable: ops
created: 2026-06-09
---

# Docs sync for shipped `sheal pull` scope

## Objective
Once D1 + D2 land, reflect the shipped local-first scope in the docs (AGENTS.md
§11 — keep ADRs/docs current as part of done).

## What we need to extract / do
- Update the `HOWTO` guide in `src/index.ts` with a `sheal pull` section
  (`--list`, `sheal pull docker <name>`).
- Add a short usage note where appropriate (README or CLAUDE.md project section).
- Note in ADR 0005 what actually shipped vs. what stayed deferred (remote tier,
  dedup, daemon) — without flipping the ADR's Proposed status unless the user
  decides to.

## Output
Doc edits: `src/index.ts` HOWTO, project docs, ADR 0005 note. none (no new
tracked artifact file).

## Dependencies
`pull-list-command` and `pull-thin-diff` shipped.

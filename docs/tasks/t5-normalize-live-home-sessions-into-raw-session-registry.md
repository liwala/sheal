---
status: todo
type: task
id: T5
deliverable: D3
created: 2026-06-11
links: [t3-normalize-pulled-sessions-into-raw-session-registry.md, q2-cross-path-dedup.md]
---

# T5. Normalize live-home sessions into the raw session registry

## Objective
Add a project-local normalization path for sessions that are already present in
the user's live agent home directories, without requiring a sandbox/container
pull first. Claude and Codex home sessions should be importable into the same
raw session registry shape created by T3.

## What we need to extract / do

- Add a CLI entry point or command option that normalizes live-home Claude and
  Codex sessions for the current project into
  `<projectRoot>/.sheal/sessions/raw/<stable-session-id>/`.
- Reuse the explicit-root reader support from T3 so the implementation works
  from `~/.claude`, `~/.codex`, and explicit source roots.
- Preserve the T3 raw registry contract: `manifest.json`,
  `transcript.raw.jsonl` when available, `normalized.json`, content hashes, and
  source provenance.
- Record source kind as live-home or explicit-source rather than pull, and do
  not write pull-only `ingested.json` markers.
- Ensure repeated normalization of the same live-home transcript reuses or
  updates the same raw session record rather than creating duplicates.
- Keep Q2 open for future cross-source aliasing between live-home, pull, and
  remote/cloud sources.
- Do not wire `retro`, `ask`, `digest`, `browse`, or learning generation to
  consume the raw registry in this task.

## Done when

- End-to-end tests show a live-home Claude transcript under
  `~/.claude/projects/<project-slug>/*.jsonl` is normalized into
  `<projectRoot>/.sheal/sessions/raw/<stable-session-id>/`.
- End-to-end tests show a live-home Codex transcript under
  `~/.codex/sessions/` is normalized into the same project-local raw registry
  shape.
- Tests cover explicit source roots for Claude and Codex, separate from the
  current user's real home directories.
- Re-running normalization for the same transcript updates or reuses the same
  raw session record.
- The raw session manifest records live-home or explicit-source provenance and
  source transcript paths.
- Secret-like artifact files from agent homes are not copied into raw session
  records.
- Existing pull normalization and live-home readers remain green.

## Output

Code and tests for live-home and explicit-source normalization into
`<projectRoot>/.sheal/sessions/raw/`. Expected touch points include
`src/sessions/raw-registry.ts`, CLI command wiring, and focused tests.

## Dependencies

Requires T3's raw session registry contract and explicit-root Claude/Codex
reader support. Relates to Q2 for future cross-source aliases.

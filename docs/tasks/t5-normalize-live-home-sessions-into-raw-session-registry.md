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
raw session registry shape created by T3, and user-facing entry points should
make registry coverage visible before analysis happens.

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
- Add a session inventory layer that can compare project-local raw registry
  records with live-home Claude/Codex sessions and classify each session as
  registry-backed or live-home-only.
- Update `sheal browse` so it shows both registry-backed sessions and
  live-home-only sessions for the current project, with clear backup/registry
  status in the UI.
- When `sheal browse` starts and live-home-only sessions exist, notify the user
  that some visible sessions are not backed up in the sheal registry yet and
  offer to add them.
- When `sheal retro` starts against a live-home-only Claude or Codex session,
  prompt the user to add that session to the registry before continuing. A
  declined prompt should continue with today's live-home behavior rather than
  blocking analysis.
- Keep Q2 open for future cross-source aliasing between live-home, pull, and
  remote/cloud sources.
- Do not wire `ask`, `digest`, or learning generation to consume the raw
  registry in this task. `browse` and `retro` changes are limited to visibility,
  backup status, and import prompts.

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
- `sheal browse` lists both registry-backed and live-home-only sessions for the
  current project, and live-home-only sessions are visibly marked as not backed
  up yet.
- Starting `sheal browse` with live-home-only sessions surfaces an import offer
  before or during the session list flow.
- Starting `sheal retro` for a live-home-only Claude or Codex session offers to
  add it to the registry before analysis, while declining keeps existing
  behavior working.
- Existing pull normalization and live-home readers remain green.

## Output

Code and tests for live-home and explicit-source normalization into
`<projectRoot>/.sheal/sessions/raw/`. Expected touch points include
`src/sessions/raw-registry.ts`, session inventory code, `sheal browse`,
`sheal retro`, CLI command wiring, and focused tests.

## Dependencies

Requires T3's raw session registry contract and explicit-root Claude/Codex
reader support. Relates to Q2 for future cross-source aliases.

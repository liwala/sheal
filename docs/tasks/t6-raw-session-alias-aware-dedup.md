---
status: todo
type: task
id: T6
deliverable: D3
created: 2026-06-12
links: [q2-cross-path-dedup.md]
---

# T6. Add raw session alias-aware dedup

## Objective
Implement the Q2 raw-registry identity contract so future remote/cloud captures
can link to existing local raw sessions without double-counting one agent run as
independent evidence.

## What we need to extract / do

- Extend the raw session manifest with a canonical identity block containing
  authoritative aliases and a capture list with source kind, fidelity, hashes,
  and provenance.
- Teach normalization to resolve a new capture to an existing canonical raw
  record when it shares an authoritative alias: agent native session id,
  provider run/session id, explicit adapter alias, or exact transcript hash.
- Preserve all captures as provenance and select the primary raw material by
  fidelity, so a lower-fidelity source cannot overwrite a transcript+diff
  capture.
- Store PR/branch/commit/time-window data as correlation hints only. Do not use
  those hints for automatic dedup.
- Mark captures without an authoritative alias as needing a link before they can
  contribute to confidence aggregation.

## Done when

- End-to-end tests prove repeated local pulls/imports still resolve to one raw
  record.
- Tests prove two captures with different source paths but a shared
  authoritative alias resolve to one canonical raw record with multiple captures
  recorded in `manifest.json`.
- Tests prove a lower-fidelity capture cannot delete or replace higher-fidelity
  transcript/diff material.
- Tests prove PR/branch/commit hints alone do not auto-dedup sessions.
- The raw registry contract documents how future remote/cloud adapters should
  populate aliases, correlation hints, and capture fidelity.

## Output

Code, tests, and raw-registry contract docs for alias-aware canonical session
identity. Expected touch points include `src/sessions/raw-registry.ts`,
raw-registry tests, and the D3 task docs.

## Dependencies

Requires the T3/T5 raw session registry and the Q2 decision. Should land before
the first remote/cloud source writes raw session records.

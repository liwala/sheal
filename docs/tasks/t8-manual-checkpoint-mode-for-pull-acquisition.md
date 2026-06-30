---
status: done
started: 2026-06-19
closed: 2026-06-19
type: task
id: T8
deliverable: D2
created: 2026-06-19
links: [q3-daemon-checkpointing.md, ../adr/0005-sheal-pull-acquisition-adapters.md]
output: src/commands/pull.ts, src/index.ts, src/pull/stage.ts, src/pull/types.ts, test/pull-checkpoint.test.ts, README.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
---

# T8. Manual checkpoint mode for pull acquisition

## Objective
Add a small host-side checkpointing slice so a reachable local runtime can leave
a recent capture footprint before teardown, without building the long-running
daemon yet.

## What we need to extract / do

- Add a manual checkpoint entrypoint to the existing pull command surface.
- Reuse the local adapter capture set and pull staging root so checkpoints
  capture diff, agent artifacts, transcripts, provenance, and gap details.
- Mark checkpoint stages explicitly so later daemon/consolidation work can tell
  them apart from full pull-normalized stages.
- Keep daemon scheduling, remote/cloud adapters, and consolidation-consumed
  signalling out of scope.

## Done when

- End-to-end CLI tests prove `sheal pull <backend> <name> --checkpoint` writes a
  checkpoint stage for a local runtime.
- Tests prove the checkpoint stage preserves provenance and gap information.
- Tests prove checkpoint mode does not normalize into the raw session registry or
  write a pull-only `ingested.json` marker.
- README and ADR 0005 describe the manual checkpoint contract and remaining
  daemon follow-up.

## Output
Code, tests, and docs for manual checkpoint capture.

## Dependencies
Requires the existing pull staging root, local runtime adapters, and Q3
checkpointing decision.

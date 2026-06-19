---
status: done
started: 2026-06-19
closed: 2026-06-19
type: task
id: T9
deliverable: D2
created: 2026-06-19
links: [t8-manual-checkpoint-mode-for-pull-acquisition.md, q3-daemon-checkpointing.md, ../adr/0005-sheal-pull-acquisition-adapters.md]
output: src/commands/pull.ts, src/index.ts, src/config/types.ts, src/config/defaults.ts, test/pull-checkpoint.test.ts, README.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
---

# T9. Opt-in checkpoint runner

## Objective
Add a run-once checkpoint runner that checkpoints only explicitly configured
local runtime targets, building on the manual `sheal pull <backend> <name>
--checkpoint` primitive without introducing daemon lifecycle yet.

## What we need to extract / do

- Add a minimal opt-in checkpoint target policy to project configuration.
- Add a run-once CLI entrypoint that checkpoints configured local targets using
  the existing pull adapter capture path.
- Ensure unconfigured local sandboxes are ignored even when the backend can list
  them.
- Keep `--all` from implying checkpoint-all behavior.
- Keep remote/cloud adapters, raw-registry normalization,
  consumed/consolidated signalling, and long-running daemon lifecycle out of
  scope.

## Done when

- End-to-end CLI tests prove configured local targets are checkpointed.
- End-to-end CLI tests prove unconfigured local targets are ignored.
- End-to-end CLI tests prove checkpoint stages preserve `checkpoint.json`,
  checkpoint provenance, and gap details.
- End-to-end CLI tests prove bulk/all checkpointing is not implicit.
- README and ADR 0005 describe the opt-in runner contract and remaining daemon
  follow-up.

## Output
Code, tests, and docs for the opt-in checkpoint runner.

## Dependencies
Requires T8 manual checkpoint mode and the existing local pull adapter registry.

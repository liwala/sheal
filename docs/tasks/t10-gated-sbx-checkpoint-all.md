---
status: done
started: 2026-06-19
closed: 2026-06-19
type: task
id: T10
deliverable: D2
created: 2026-06-19
links: [t9-opt-in-checkpoint-runner.md, q3-daemon-checkpointing.md, ../adr/0005-sheal-pull-acquisition-adapters.md]
output: src/commands/pull.ts, src/index.ts, src/config/types.ts, src/config/defaults.ts, test/pull-checkpoint.test.ts, README.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
---

# T10. Gated sbx checkpoint-all

## Objective
Allow `sheal pull sbx --all --checkpoint` only behind an explicit config gate,
so checkpoint-all is intentional and limited to the local `sbx` backend.

## What we need to extract / do

- Add an explicit allow-all checkpoint policy to project configuration.
- Make `sheal pull sbx --all --checkpoint` reject by default.
- When the gate includes `sbx`, checkpoint every eligible listed sbx sandbox
  using the existing checkpoint stage contract.
- Skip missing workspaces consistently with `sheal pull sbx --all`.
- Keep `docker --all --checkpoint` unsupported.
- Keep remote/cloud adapters, raw-registry normalization,
  consumed/consolidated signalling, and daemon lifecycle out of scope.

## Done when

- End-to-end CLI tests prove `sbx --all --checkpoint` is rejected without the
  config gate.
- End-to-end CLI tests prove gated `sbx --all --checkpoint` checkpoints every
  eligible listed sbx sandbox and skips missing workspaces.
- Tests prove checkpoint-all stages preserve `checkpoint.json`, provenance, and
  gap details.
- Tests prove checkpoint-all does not normalize into the raw registry or write
  `ingested.json`.
- Tests prove `docker --all --checkpoint` remains unsupported.
- README and ADR 0005 describe the allow-all checkpoint contract.

## Output
Code, tests, and docs for gated sbx checkpoint-all.

## Dependencies
Requires T8 manual checkpoint mode and T9 opt-in checkpoint runner.

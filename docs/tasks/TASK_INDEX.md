> Frontmatter is the source of truth. This index is a derived view — if they disagree, read the individual .md files.

## D1 — Discovery (`sheal pull --list`)

- [x] [`sheal pull --list` end-to-end (discovery slice)](pull-list-command.md) — `done` → src/commands/pull.ts

## D2 — Pull (`sheal pull sbx <name>`, `sheal pull sbx --all`)

- [x] [Thin pull: capture git diff to staging with provenance](pull-thin-diff.md) — `done` → src/commands/pull.ts
- [x] [T1. Batch pull all sbx sandboxes](t1-batch-pull-all-sbx-sandboxes.md) — `done` → src/commands/pull.ts
- [x] [T2. Docker pull adapter end-to-end alongside sbx](t2-docker-pull-adapter-end-to-end.md) — `done` → src/pull/adapters/docker.ts, src/pull/registry.ts, src/commands/pull.ts, test/pull-docker.test.ts, test/pull-list.test.ts
- [x] [T4. Fix pull capture to use agent home dirs](t4-fix-pull-capture-to-use-agent-home-dirs.md) — `done` → src/pull/capture-set.ts, test/pull-capture.test.ts, test/pull-docker.test.ts, README.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
- [x] [Full capture set with gap logging](pull-full-capture-set.md) — `done` → src/commands/pull.ts, src/pull/adapters/sbx.ts, src/pull/capture-set.ts, test/pull-capture.test.ts
- [x] [Unknown sandbox name error path](pull-unknown-name-error.md) — `done` → src/commands/pull.ts, test/pull-errors.test.ts

## D3 — Raw Session Normalization

- [x] [T3. Normalize pulled sessions into a raw session registry](t3-normalize-pulled-sessions-into-raw-session-registry.md) — `done` → src/sessions/raw-registry.ts, src/commands/pull.ts, packages/agent-sessions/src/claude.ts, packages/agent-sessions/src/codex.ts, test/pull-raw-registry.test.ts, test/native-reader-roots.test.ts
- [x] [T5. Normalize live-home sessions into the raw session registry](t5-normalize-live-home-sessions-into-raw-session-registry.md) — `done` → src/sessions/raw-registry.ts, src/commands/sessions.ts, src/sessions/inventory.ts, src/browse/views/SessionList.tsx, src/commands/retro.ts, src/index.ts, test/live-home-raw-registry.test.ts, test/session-inventory.test.ts, test/retro-command.test.ts, README.md
- [x] [T6. Add raw session alias-aware dedup](t6-raw-session-alias-aware-dedup.md) — `done` → src/sessions/raw-registry.ts, src/pull/types.ts, src/pull/adapters/sbx.ts, test/pull-raw-registry.test.ts, test/live-home-raw-registry.test.ts, docs/tasks/t3-normalize-pulled-sessions-into-raw-session-registry.md, docs/adr/0005-sheal-pull-acquisition-adapters.md

## ops — Cross-cutting

- [x] [Config setting for staging directory](pull-staging-config.md) — `done` → src/config/types.ts, src/config/defaults.ts, src/config/loader.ts, src/commands/pull.ts, test/pull-config.test.ts
- [x] [Docs sync for shipped `sheal pull` scope](pull-docs-sync.md) — `done` → src/index.ts, README.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
- [x] [T7. Configurable pull staging retention/GC](t7-configurable-pull-staging-retention-gc.md) — `done` → src/config/types.ts, src/config/defaults.ts, src/pull/stage.ts, src/commands/pull.ts, src/index.ts, test/pull-retention.test.ts, docs/tasks/q4-staging-retention-gc.md, docs/adr/0005-sheal-pull-acquisition-adapters.md

## Open questions

**Answered (history):**

- [x] [Q1. How should the remote/cloud adapter tier work?](q1-remote-adapter-tier.md) — `done`
- [x] [Q2. How do we dedup a session captured by more than one path?](q2-cross-path-dedup.md) — `done`
- [x] [Q3. Do we need a daemon / mid-session checkpointing for crashed environments?](q3-daemon-checkpointing.md) — `done`
- [x] [Q4. What is the staging retention / GC policy?](q4-staging-retention-gc.md) — `done`
- [x] [Q5. Implement lima/orbstack adapters alongside docker, or docker-only first?](q5-lima-orbstack-scope.md) — `done`

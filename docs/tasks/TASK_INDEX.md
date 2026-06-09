> Frontmatter is the source of truth. This index is a derived view — if they disagree, read the individual .md files.

## D1 — Discovery (`sheal pull --list`)

- [x] [`sheal pull --list` end-to-end (discovery slice)](pull-list-command.md) — `done` → src/commands/pull.ts

## D2 — Pull (`sheal pull sbx <name>`)

- [ ] [Thin pull: capture git diff to staging with provenance](pull-thin-diff.md) — `doing`
- [ ] [Full capture set with gap logging](pull-full-capture-set.md) — `todo`
- [ ] [Unknown sandbox name error path](pull-unknown-name-error.md) — `todo`

## ops — Cross-cutting

- [ ] [Config setting for staging directory](pull-staging-config.md) — `todo`
- [ ] [Docs sync for shipped `sheal pull` scope](pull-docs-sync.md) — `todo`

## Open questions

**For Luisa:**

- [ ] [Q1. How should the remote/cloud adapter tier work?](q1-remote-adapter-tier.md) — `todo`
- [ ] [Q2. How do we dedup a session captured by more than one path?](q2-cross-path-dedup.md) — `todo`
- [ ] [Q3. Do we need a daemon / mid-session checkpointing for crashed environments?](q3-daemon-checkpointing.md) — `todo`
- [ ] [Q4. What is the staging retention / GC policy?](q4-staging-retention-gc.md) — `todo`

**Answered (history):**

- [x] [Q5. Implement lima/orbstack adapters alongside docker, or docker-only first?](q5-lima-orbstack-scope.md) — `done`

---
status: done
type: question
owner: luisa
created: 2026-07-06
closed: 2026-07-06
---

# Q6. Where does the project-tier wiki live long-term — in git or in `.sheal/`?

**Why it matters:** ADR 0001 D2 currently specifies `.sheal/wiki/` (gitignored,
synced via the learn-remote machinery, consistent with "sheal owns its data").
But a project wiki is exactly the artifact a team wants in git: reviewable
diffs, PR-able page edits, provenance in history — the Karpathy LLM-wiki
argument. The T11 validation evidence lived awkwardly in `docs/` precisely
because this wasn't decided.

- Branch A (`.sheal/wiki/`, gitignored + remote sync) → single ownership model,
  no repo noise, works for solo users; team review requires sheal tooling.
- Branch B (git-committed, e.g. `docs/wiki/` or `.sheal/wiki/` un-ignored) →
  free team review and history; but sheal now writes to tracked files, PR churn
  on every consolidation, and the store/schema divergence problem returns.
- Branch C (hybrid) → pages live in `.sheal/wiki/`, and an emitter publishes
  reviewed snapshots into git on promotion — consistent with "compiled
  artifacts are the delivery vehicle".

**Answer (Luisa, 2026-07-06, in session): Branch C — the hybrid.** Working
pages live in `.sheal/wiki/` (sheal-owned, decaying, remote-synced); **reviewed
snapshots are published into git on promotion**. This keeps consolidation churn
out of the repo, preserves "sheal moves knowledge into stores it doesn't own"
(the git snapshot is an emitter target, exactly like compiled skills), and
makes the team-review surface coincide with the promotion boundary.

To ratify in the wiki-layer ADR when P1 ships. Deferred there: snapshot
destination path, what a promotion diff looks like, and whether demotion
retracts a published snapshot or archives it. Also still open: whether team
review is a P1 launch requirement or arrives with the team tier (P3) — that
decides how much publication machinery the first version needs.

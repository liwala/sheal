---
status: todo
type: question
owner: luisa
created: 2026-07-07
---

# Q7. Is `docs/adr/0001-validation/` frozen evidence or the living successor-rule surface?

**Why it matters:** the folder's README declares it frozen milestone
evidence ("never updated"), yet PR #48 edits two files there (recording the
T1/T2 and LEARN-031/043 decisions) and 26 store learnings now carry
`**Superseded by:**` pointers into its topic pages as their *living*
successor rules. Q6 decided the wiki layer lives in `.sheal/wiki/` with
snapshots published to git on promotion — so the validation folder has
become a de facto wiki layer ahead of that decision. Raised by the pr-tutor
pass on PR #48.

- Branch A — keep it frozen: move the merged rules + trigger tables into the
  Q6 wiki layer when it lands (P1); repoint store provenance there; the
  validation folder reverts to evidence-only. Costs a migration of 26
  pointers (mechanical — a decisions file can do it).
- Branch B — declare the topic pages living: amend the folder README (and
  ADR 0001) to say the merged rules are maintained here until the wiki layer
  exists; accept decision annotations in frozen evidence.
- Related loose end either way: AGENTS.md's "Session Learnings" section
  still injects the old LEARN-001…030 prose, including superseded rules —
  decide whether it regenerates from the live store or trims to the
  successor pages.

**Still open:** which branch; and whether the wiki-layer ADR (which ratifies
Q6) should resolve this in the same stroke.

# Wiki candidates — ADR 0001 validation milestone output

**Date:** 2026-07-06 · **Task:** T11 · **Source:** one-shot consolidation pass
over `.sheal/learnings/` (55 files, 53 distinct learnings) + `.sheal/retros/`.

This directory is the reviewable output of the validation milestone defined in
[ADR 0001](../adr/0001-sheal-as-consolidation-system.md) § "First step". It is
**a proposal, not applied state**: no learning files have been merged, retired,
or renumbered. The maintainer reviews these pages; executing the dispositions
is a separate task.

## Verdict against the acceptance criteria

**The consolidation frame is real — proceed toward Accepted, with one revision.**

- 49 of 53 learnings (92%) grouped into six coherent topic pages without
  forcing; the four that resist grouping are explained in
  [contradictions-and-dispositions.md](contradictions-and-dispositions.md).
- The contradictions list is non-empty, and includes two genuine precedence
  conflicts (not just duplicates) that require a human call.
- Strongest finding: the store already contains a **failed ad-hoc consolidation
  attempt**. IDs 001–012 each exist twice — a "long-slug" generation matching
  AGENTS.md, and a "short-slug" generation of condensed/merged rewrites that
  was written back into the same store, colliding IDs and never retiring its
  sources. Consolidation happened because it was needed; it corrupted the store
  because merge/retire/supersede don't exist as verbs. That is ADR 0001's
  thesis, demonstrated by the corpus itself.

**Revision to carry into the ADR:** the durable unit is the topic page _as the
store_, with compiled skills as the delivery vehicle — several "distinct"
learnings turned out to be one rule at different trigger thresholds, so a page
must own a **trigger table**, not just prose.

## The six candidate pages

| Page                                                                        | Members | Tier    |
| --------------------------------------------------------------------------- | ------- | ------- |
| [Ground truth before action](ground-truth-before-action.md)                 | 7       | global  |
| [Plan before you edit](plan-before-you-edit.md)                             | 10      | global  |
| [Working-session cadence](working-session-cadence.md)                       | 9       | global  |
| [Environment & sandbox diagnostics](environment-and-sandbox-diagnostics.md) | 8       | global  |
| [Git branch & PR mechanics](git-branch-and-pr-mechanics.md)                 | 5       | global  |
| [Data-flow debugging](data-flow-debugging.md)                               | 4       | project |

Five of six pages are cross-project — confirming ADR 0001 D2's global tier.

## Corpus inventory highlights

- 55 files, 43 numeric IDs, 12 ID collisions (all mechanically detected by
  `sheal learn lint`), 16 drafts absent from AGENTS.md.
- 10 short-generation items are `status: active` yet absent from AGENTS.md —
  the store and the schema file have diverged.
- `session-id` provenance exists only from LEARN-019 onward; LEARN-015–018
  have no matching retro at all.
- Tags are session-inherited, not content-derived (a `git stash` rule tagged
  `react`) — tag generation needs the same quality gate as learnings.
- One retro rule ("sync with main before starting refactor work",
  retro `c2be4252`) was never captured as a LEARN file at all.

## What execution would produce

53 learnings → 6 topic pages containing ~24 merged rules, 2 seed items,
2 items reclassified as product tasks, **12 mechanical compilation targets**
(hooks/checkers instead of prose), and 2 precedence conflicts for human review
— exactly the `sheal review` queue shape ADR 0001 describes.

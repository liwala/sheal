# Plan before you edit (churn control)

**Tier:** global · **Confidence:** high — the corpus's chronic failure mode
(index.ts edited 19x, SessionDetail.tsx 19x, SessionList.tsx 11x per retros).

For any change touching >3 files or any multi-state UI, write the file-level
plan / state machine first, then implement in one planned pass per file.

## Members

| ID                 | Gist                                                        | Provenance                       |
| ------------------ | ----------------------------------------------------------- | -------------------------------- |
| LEARN-011L (+004S) | File-level plan before touching >3 files                    | 2026-03-20, retro `ba1775df5773` |
| LEARN-005L         | Bootstrap projects with full structure planned upfront      | 2026-03-13, retro `c4419b557931` |
| LEARN-009L         | Infra phase complete and verified before feature work       | 2026-03-13, same                 |
| LEARN-014L (+005S) | One screen end-to-end before adding navigation              | 2026-03-20, retro `ba1775df5773` |
| LEARN-024          | Define full state machine before interactive TUI flows      | 2026-03-26, session `b39d0c2a`   |
| LEARN-011S         | Clarify full UX flow (confirm/cancel/draft) before coding   | 2026-03-26                       |
| LEARN-010S         | Implement all UI states in one edit                         | 2026-03-26, retro `939d05a58e99` |
| LEARN-023          | Register all CLI subcommands in one router edit             | 2026-03-26, session `b39d0c2a`   |
| LEARN-027          | Component edited 5+ times → stop, design on paper, one pass | 2026-04-14, session `f704d6d6`   |
| LEARN-012S         | Re-read a file after 3+ edits before editing again          | 2026-03-26                       |

## Proposed merged rules

1. **File-level plan:** any change touching >3 files — write which files
   change and what each change is, then execute. Bootstrap structure (005L)
   and infra-before-features (009L) are instances. _(absorbs 004S)_
2. **Multi-state UI:** define the state machine and the full flow
   (confirm/cancel/draft/escape) before coding; implement all states of one
   component in one pass. Escalation clause: a component at 5 edits in one
   session is the crisis trigger for this rule. _(absorbs 024, 011S, 010S, 027)_
3. **Increment at screen level, batch at state level:** one screen working
   end-to-end before adding navigation; within a screen, all states in one
   edit. _(resolves the 014L vs 010S tension — see contradictions T3)_

## Trigger table

| Trigger                                     | Rule              |
| ------------------------------------------- | ----------------- |
| Change plan touches >3 files                | 1                 |
| New interactive flow with ≥2 states         | 2                 |
| Same component edited 5+ times this session | 2 (crisis clause) |
| Adding a second screen/view                 | 3                 |

## Mechanical candidates

- Per-file edit counter (≥5 in a session) → hook that injects rule 2's crisis
  clause instead of trusting prose.

# Contradictions, near-duplicates, and dispositions

Output of the T11 consolidation pass. **Proposal only** — nothing in
`.sheal/learnings/` has been changed.

## Genuine tensions (human call required — `sheal review` queue material)

- **T1 — re-read vs. don't re-read.** LEARN-040 ("don't re-read files already
  in context") conflicts with LEARN-013 ("re-read 3 most-recent files after
  compaction") and LEARN-012S ("re-read after 3+ edits"). Proposed precedence:
  trust context _by default_; re-read only on the two named triggers
  (compaction occurred, or file touched 3+ times). No file states this today.
- **T2 — verify-per-edit vs. batch-into-one-edit.** LEARN-016/007S ("compile
  after each file, never batch") pulls against LEARN-023/010S/027 ("collect
  changes into a single edit pass"). Proposed resolution: batch all changes
  _to one file_ into one edit; verify after each _file_.
- **T3 (soft) — incrementalism vs. batching in UI work.** LEARN-014L ("one
  screen before adding more") vs. LEARN-010S ("all UI states in one edit").
  Compatible if scoped: increment at screen level, batch at state level.
  Resolved as rule 3 of [plan-before-you-edit](plan-before-you-edit.md).

## Near-duplicate groups (merge + retire)

| Group                                | Merged into                      | Retire                               |
| ------------------------------------ | -------------------------------- | ------------------------------------ |
| 001L, 001S, 003L, 006L               | ground-truth rule 1              | 001S, 006L (fold 003L)               |
| 002L, 002S, 012L                     | ground-truth rule 2              | 002S (fold 012L)                     |
| 010L, 013, 003S                      | cadence rule 1 (adopt 003S text) | 010L, 013 as separate items          |
| 011L, 004S (005L, 009L as instances) | plan rule 1                      | 004S; demote 005L/009L to examples   |
| 014L, 005S                           | plan rule 3                      | 005S                                 |
| 016, 007S, 008L                      | cadence rule 3                   | 007S (fold 008L)                     |
| 017, 008S                            | environment rule 1               | 008S                                 |
| 015, 006S                            | environment rule 4               | 006S                                 |
| 018, 009S, 040                       | cadence rule 4                   | 009S (fold 040, subject to T1)       |
| 025, 028                             | ground-truth rule 3              | 028                                  |
| 038, 042                             | git rule 2                       | 042 (intra-session duplicate)        |
| 021, 022                             | cadence rule 2                   | fold 021                             |
| 019, 020                             | — reclassified (below)           | both                                 |
| 024, 011S, 010S, 027                 | plan rule 2                      | fold 011S, 010S; 027 = crisis clause |

## Reclassified: product feedback, not learnings

- **LEARN-019, LEARN-020** (retro input completeness) are bug reports against
  sheal's own retro pipeline, not agent-behavior rules. Disposition: retire
  from the learnings store; file as a sheal task ("validate checkpoint
  completeness inside `sheal retro`"). Their existence shows the retro
  extractor needs a "product feedback vs. learning" branch.

## Seeds (too thin for a page; volume trigger pending)

- **LEARN-037** (propose non-destructive alternatives, don't execute) and
  **LEARN-041** (user says "no, it was X" → pivot, don't defend): a coherent
  conversational-repair pair. A page materializes if a third arrives.

## Mechanical compilation targets (12)

Learnings that should become hooks/checkers/config, not prose — per the
"memory has standing cost" principle:

| Learning | Compilation target                                     |
| -------- | ------------------------------------------------------ |
| 004L     | already `.self-heal.json` `requiredServices` (shipped) |
| 007L     | `sheal check` non-zero exit on warnings                |
| 008L/016 | post-edit toolchain hook (`npx tsc` / `go build`)      |
| 010L/013 | SessionStart(compact) hook injecting the protocol      |
| 017      | SessionStart container inventory hook                  |
| 018      | identical-consecutive-failure detector                 |
| 021/022  | touched-file counter ≥5 gate                           |
| 026      | pre-checkout dirty-tree guard                          |
| 027      | per-file edit counter ≥5                               |
| 038      | pre-PR `git rev-list base..HEAD` check                 |
| 043      | `sheal capture` crisis verb                            |
| 019/020  | validation inside `sheal retro` (as a product task)    |

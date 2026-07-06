# Git branch & PR mechanics

**Tier:** global · **Confidence:** medium (two sessions; three members draft).

Branch arithmetic before PR operations: verify the working tree is clean
before switching, verify the branch is actually ahead of base before opening a
PR, and derive branch points from commit parents, not current main.

## Members

| ID        | Gist                                                       | Provenance                             |
| --------- | ---------------------------------------------------------- | -------------------------------------- |
| LEARN-026 | Stash (incl. untracked) before branch switch on dirty tree | 2026-04-14, session `f704d6d6`         |
| LEARN-029 | Stacked PRs: create all branches upfront from one base     | 2026-04-14, same (draft)               |
| LEARN-035 | PR for existing commit → branch from its parent            | 2026-05-07, session `3c7c67a3` (draft) |
| LEARN-038 | Verify branch has commits base lacks before PR             | 2026-05-07, same (draft)               |
| LEARN-042 | Same as 038, commit-split variant                          | 2026-05-07, same (draft)               |

## Proposed merged rules

1. **Clean switch:** before `git checkout <branch>`, if `git status` shows
   changes, `git stash --include-untracked` first.
2. **Ahead-of-base check:** before opening a PR, verify
   `git rev-list base..HEAD` is non-empty. _(absorbs 042 — an intra-session
   duplicate the retro pipeline emitted twice in one day)_
3. **Branch-point arithmetic:** a PR for an existing commit branches from
   that commit's parent; stacked PRs create all branches upfront from one
   base.

Uncaptured member: retro `c2be4252` produced "sync with main before starting
refactor work" — it belongs here but was never written to the store (leakage
between retro output and the learnings store).

## Mechanical candidates

- Rule 1 → pre-checkout guard (Bash hook on `git checkout` with dirty tree).
- Rule 2 → pre-PR checker (`gh pr create` hook or `sheal` checker running the
  rev-list test).

---
status: todo
type: task
id: T20
deliverable: P0
created: 2026-07-06
links: ["https://github.com/liwala/sheal/pull/46", "https://github.com/liwala/sheal/pull/47"]
---

# T20. Harden the T14 gates against the qa-personas bypasses

## Objective

The qa-personas run on PR #46 found reproducible advisory weaknesses in the
new gates; this task tracks hardening them (the PR body said "tracked for
follow-up" — this is the tracking artifact).

## What we need to extract / do

- `sheal guard pr`: exits 0 on an empty commit (counts commits, not diff —
  consider `git diff --stat base..HEAD` non-empty), on detached HEAD (branch
  reported as "HEAD"), and when `--base` is any ancestor while sitting on
  `main`. Base default also misfires on stacked branches (make it PR/config
  aware).
- `sheal check --strict`: silently neutralized by `--skip` or a committed
  `.self-heal.json` skip list — decide whether strict should report (or
  refuse) skipped checkers.
- `sheal consolidate --prompt`: interpolates learning bodies verbatim/unfenced
  — fence or sanitize store content against indirect prompt injection.
- UX: malformed learning file aborts consolidate/lint without naming the file;
  `check -p <bad path>` exits 0 with a misleading message.

## Done when

- Each bypass has a red-first test and either a fix or a documented,
  deliberate decision not to change it.

## Output

src/commands/guard.ts, src/commands/check.ts, src/consolidate/change-set.ts,
src/learn/lint.ts.

## Dependencies

PR #47 merged.

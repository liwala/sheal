---
status: todo
type: question
owner: luisa
created: 2026-07-17
---

# Q8. Strict-mode semantics: how should `--strict` treat skipped checkers, and should the JSON summary expose a `strictOk` field?

**Why it matters:** two qa-personas advisories against the T14 gates hang on
this, and T20 (Harden the T14 gates against the qa-personas bypasses) is
blocked until it's decided. It also shapes T16 (Wire guard pr and check
--strict into hooks/CI) — CI behavior changes for anyone using skips.

- Decision A — skipped checkers under `--strict`:
  - Branch A1 (report): `--strict` lists skipped checkers in output/summary
    but they don't affect the exit code. Visible, non-breaking; a committed
    skip list still silently passes CI.
  - Branch A2 (refuse): `--strict` treats any skipped checker (via `--skip`
    or `.self-heal.json` skip list) as a failure — strict means "nothing was
    skipped". Stronger gate; breaks legitimate machine-local skips unless
    `.self-heal.local.json` skips are exempted.
  - Branch A3 (warn-as-warning): skips count as warnings, and since strict
    exits 1 on warnings, they fail strict — but via the existing
    `resultHasWarnings` predicate rather than a new rule.
- Decision B — `summary.healthy` stays `true` under strict exit 1 (fail-only
  by design). Add a `strictOk: boolean` field to the JSON summary so
  machine consumers see the strict verdict without re-deriving it? (QA
  suggested it; deliberately left unfixed pending this call.)

**Still open:** both A and B; answering unblocks T20.

---
status: todo
type: task
id: T26
deliverable: P0
created: 2026-07-17
links:
  - https://github.com/liwala/sheal/pull/49
---

# T26. Reject path traversal in session-id → file resolution (native loaders)

## Objective

qa-personas on PR #49 reproduced a pre-existing [High] path traversal: a
crafted checkpoint id (`sheal retro -c "../../../../tmp/leak"`) escapes the
projects slug directory because `@liwala/agent-sessions` resolves session
files with an unsanitized `join(dir, `${sessionId}.jsonl`)`. Any
out-of-tree `.jsonl` can be loaded and fully analyzed. Local CLI, so the
attacker is usually the operator — but ids also arrive from automation
(hooks, ship pipelines, `--last` inventories), and the same pattern likely
exists in the codex/gemini/amp loaders.

## What we need to extract / do

- Audit every session-id → path resolution in `packages/agent-sessions`
  (claude, codex, gemini, amp, entire readers) for the same pattern.
- Validate ids at the boundary: reject separators/`..` (or resolve and
  verify containment in the expected root) with a clean, id-naming error.
- ADVERSARIAL tests per loader (the traversal is rejected), plus the happy
  path still resolving.

## Done when

- `sheal retro -c "../../../../tmp/anything"` (and equivalents in other
  loaders) fails with a clean validation error; red-first tests prove it;
  suite green.

## Output

packages/agent-sessions/src/ (loaders), tests.

## Dependencies

None (pre-existing on main; independent of the PR #48/#49 stack).

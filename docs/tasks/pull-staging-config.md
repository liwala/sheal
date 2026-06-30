---
status: done
started: 2026-06-10
closed: 2026-06-10
type: task
deliverable: ops
created: 2026-06-09
output: src/config/types.ts, src/config/defaults.ts, src/config/loader.ts, src/commands/pull.ts, test/pull-config.test.ts
---

# Config setting for staging directory

## Objective

Make the pull staging location configurable (ADR 0005 §Scope, resolves Q3 for the
local cut), defaulting to the existing `.sheal/pulls` convention.

**Updated default decision (implemented by T3 on 2026-06-11):** pull staging
defaults to `~/.sheal/pulls`, while normalized raw session records remain
project-local under `<projectRoot>/.sheal/sessions/raw/`. The configurable
`pull.stagingDir` override still applies.

## What we need to extract / do

TDD order (§1):

1. **Write the failing test** (`test/pull-config.test.ts`): when
   `.self-heal.json` sets `pull.stagingDir`, pull resolves to it; otherwise it
   defaults to `.sheal/pulls/<type>/<name>/<ts>/`. Confirm red.
2. **Implement to green**, matching existing config plumbing (§5):
   - add `pull?: { stagingDir?: string }` to `SelfHealConfig` and the resolved
     shape in `src/config/types.ts`.
   - default in `src/config/defaults.ts`; merge in `src/config/loader.ts`.
   - resolve the staging base in the pull command via `loadConfig()`.
3. **Confirm green.**

DoD (§10) applies.

## Output

Code: `pull.stagingDir` across `src/config/{types,defaults,loader}.ts`; resolution
in `src/commands/pull.ts`; test `test/pull-config.test.ts`.

## Dependencies

None blocking; pairs with `pull-thin-diff` (which consumes the resolved dir).

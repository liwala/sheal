---
status: done
started: 2026-07-06
closed: 2026-07-06
type: task
id: T10
deliverable: ops
created: 2026-07-06
links: []
output: src/config/loader.ts
---

# T10. Support .self-heal.local.json machine-local config overlay

## Objective

Allow machine-local configuration (private tooling checks, host-specific
services) to extend `sheal check` without touching the shared, committed
`.self-heal.json`. Local config belongs to a machine/user, not the repo.

## What we need to extract / do

- Load `.self-heal.local.json` from the same directory as the resolved
  `.self-heal.json` (or the project root when no base config exists).
- Merge it over the base config with the same field-level semantics the base
  uses over defaults (local wins per field).
- A missing or unparsable local file must behave exactly like today (base
  config only, warning on parse failure).
- Document the overlay in the README config section and gitignore the file.

## Done when

- A `requiredServices` entry defined only in `.self-heal.local.json` is
  enforced by `sheal check`, proven by tests that fail before the change.
- Existing config tests stay green; `.self-heal.local.json` is gitignored.

## Output

src/config/loader.ts, test config coverage, README config note.

## Dependencies

None.

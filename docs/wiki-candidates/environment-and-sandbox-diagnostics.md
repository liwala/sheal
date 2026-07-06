# Environment, toolchain & sandbox diagnostics

**Tier:** global · **Confidence:** medium-high (spread across 4 sessions;
several members still draft).

When a command fails or hangs, suspect the environment before the code:
inventory tools on entry, register required services, check
sandbox/network/trust-store, and record gotchas the moment they're found.

## Members

| ID                | Gist                                                     | Provenance                             |
| ----------------- | -------------------------------------------------------- | -------------------------------------- |
| LEARN-004L        | Required services → `.self-heal.json` `requiredServices` | 2026-03-13, retro `c4419b557931`       |
| LEARN-007L        | Treat `sheal check` warnings as blockers                 | 2026-03-13, same                       |
| LEARN-017 (+008S) | Inventory OS/tools first inside containers/VMs           | 2026-03-20, session unknown (no retro) |
| LEARN-015 (+006S) | OS-specific Go compile errors → check GOOS/build tags    | 2026-03-20, same                       |
| LEARN-030         | npm audit: direct vs. transitive before pinning          | 2026-04-14, session `f704d6d6`         |
| LEARN-036         | TLS verification failure → check system trust store      | 2026-05-07, session `3c7c67a3` (draft) |
| LEARN-039         | Unexpected CLI timeout → check sandbox/network first     | 2026-05-07, same (draft)               |
| LEARN-043         | Save environmental gotchas as memory immediately         | 2026-05-07, same (draft)               |

## Proposed merged rules

1. **Entry inventory:** first command inside any container/VM/sandbox:
   inventory OS and tools (`cat /etc/os-release && which …`). _(absorbs 008S)_
2. **Required services are config, not prose:** a needed background process
   goes in `.self-heal.json` `requiredServices`; `sheal check` enforces it.
3. **Warnings are blockers:** resolve `sheal check` warnings before starting
   work.
4. **Failure-shape dispatch:** OS-specific compile error → build
   tags/GOOS; TLS failure → trust store; unexpected timeout → sandbox/network
   policy; audit finding → direct-vs-transitive first. _(absorbs 006S; groups
   015, 030, 036, 039 as one diagnostic table)_
5. **Capture on discovery:** an environmental gotcha is recorded the moment
   it's found — this is ADR 0001's crisis-capture trigger, discovered
   independently by the corpus (LEARN-043).

## Mechanical candidates

- Rule 2 is already mechanical (shipped: `requiredServices` + local overlay).
- Rule 3 → make `sheal check` exit non-zero on warnings (flag or config).
- Rule 1 → SessionStart hook when running inside a container.
- Rule 5 → a `sheal capture` crisis verb (ADR 0001 trigger taxonomy).

# Data-flow debugging (filter/group placement)

**Tier:** project (sheal codebase) · **Confidence:** low-medium — single
session, all members draft. Thinnest page; could remain one merged rule.

When items are missing or groups are stale in a display, walk the pipeline
source→display and check where each filter and grouping key is computed;
filter at the data layer.

## Members

| ID        | Gist                                                      | Provenance                             |
| --------- | --------------------------------------------------------- | -------------------------------------- |
| LEARN-031 | Filter at the data layer, not presentation                | 2026-04-23, session `019db9f3` (draft) |
| LEARN-032 | New adapter: grep existing source branches, mirror them   | 2026-04-23, same (draft)               |
| LEARN-033 | "Missing items" bug → enumerate pipeline stage filters    | 2026-04-23, same (draft)               |
| LEARN-034 | Stale/empty groups → grouping key before or after filter? | 2026-04-23, same (draft)               |

## Proposed merged rules

1. **Diagnostic walk:** "items missing / groups stale" bug → enumerate every
   pipeline stage from source to display and locate where each filter and
   grouping key is computed. _(absorbs 034 into 033)_
2. **Design principle:** filter at the data layer, not presentation.
   _(LEARN-031 — flagged by `learn lint` as no-trigger; keep as page prose,
   not a standalone rule)_
3. **Adapter symmetry:** when adding a new source adapter, grep how existing
   adapters branch and mirror the pattern.

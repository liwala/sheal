---
status: done
closed: 2026-06-10
type: question
owner: Luisa
created: 2026-06-09
---

# Q4. What is the staging retention / GC policy (ADR 0005 Q3a)?

**Why it matters:** pulled material accumulates in the staging folder. Without a
policy it grows unbounded; too aggressive and consolidation loses input before it
reads it.

- Keep until consolidation has read it, then GC → tight, needs a "consumed" mark.
- Time-based retention (e.g. N days) → simple, may drop unconsolidated captures.
- Keep everything → safe, unbounded disk.

**Follow-up implementation detail:** how "consolidated/consumed" is signalled,
and the default retention window. Tie-in: ADR 0001 consolidation reads from
staging.

**Answered (2026-06-10, Luisa):** retention should be parameterized rather than
hard-coded. For the next implementation slice, model this as a configurable
retention parameter; consumed/consolidated signalling can be added when
consolidation starts reading from staging.

**Implemented (2026-06-18, T7):** `pull.stagingRetentionDays` configures a
time-based retention window, and `sheal pull --gc` removes expired timestamped
pull staging directories under the configured staging root. Project-local raw
registry records are not part of staging GC. Consumed/consolidated signalling
remains deferred until consolidation reads from staging.

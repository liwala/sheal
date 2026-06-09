---
status: todo
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

**Still open:** how "consolidated/consumed" is signalled, and the default
retention window. Tie-in: ADR 0001 consolidation reads from staging.

---
status: todo
type: question
owner: Luisa
created: 2026-06-09
---

# Q2. How do we dedup a session captured by more than one path (ADR 0005 Q5, ADR 0004 Q2)?

**Why it matters:** once remote adapters exist, one session can be captured both
by a local pull and via its cloud PR. ADR 0001 derives a pattern's `confidence`
from how many sessions reinforce it — double-counting one session fabricates
corroboration.

- Merge on a session/run id → clean, needs a stable shared id across paths.
- Keep highest-fidelity, drop the rest → simple, but must detect "same session".
- No dedup → confidence inflation; not acceptable long-term.

**Still open:** what stable identity links two captures of the same session.
Moot while local-only.

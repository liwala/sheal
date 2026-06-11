---
status: todo
type: question
owner: Luisa
created: 2026-06-09
---

# Q2. How do we dedup a session captured by more than one path (ADR 0005 cross-path dedup, ADR 0004 Q2)?

**Why it matters:** once remote adapters exist, one session can be captured both
by a local pull and via its cloud PR. ADR 0001 derives a pattern's `confidence`
from how many sessions reinforce it — double-counting one session fabricates
corroboration.

- Merge on a session/run id → clean, needs a stable shared id across paths.
- Keep highest-fidelity, drop the rest → simple, but must detect "same session".
- No dedup → confidence inflation; not acceptable long-term.

**Still open:** what stable identity links two captures of the same session.
Moot while local-only.

**Why this becomes a problem:** sheal treats repeated evidence across sessions as
stronger evidence. If the same agent run is captured twice, for example once from
a local sandbox pull and once from a cloud PR trail, sheal may count one
experience as two independent confirmations. That can inflate confidence,
promote a weak rule too early, show duplicate timeline entries, and make future
"what happened?" queries look like multiple agents or sessions agreed when they
did not. The local-only path avoids this for now, but the first non-local capture
path needs a stable session/run identity or a highest-fidelity-wins merge rule.

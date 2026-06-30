---
status: done
closed: 2026-06-10
type: question
owner: Luisa
created: 2026-06-09
---

# Q3. Do we need a daemon / mid-session checkpointing for crashed environments (ADR 0005 D4, Q6a)?

**Why it matters:** host-side `sheal pull` can't capture a sandbox that was fully
destroyed with no footprint and no teardown hook. Mid-session checkpointing would
leave a recent footprint even after a crash.

- On-demand pull only → simplest; loses crashed/destroyed sessions.
- Interval checkpointing (daemon) → survives crashes; new long-running process,
  state, and scheduling to own.

**Follow-up implementation detail:** checkpoint interval, what a checkpoint
captures vs. a full pull, and whether the daemon is opt-in per runtime.

**Answered (2026-06-10, Luisa):** yes, crashed/destroyed environments do need
daemon or mid-session checkpointing. The concrete checkpoint interval, capture
set, and runtime opt-in behavior should be defined in a follow-up implementation
task.

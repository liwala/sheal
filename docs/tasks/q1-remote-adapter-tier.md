---
status: todo
type: question
owner: Luisa
created: 2026-06-09
---

# Q1. How should the remote/cloud adapter tier work (ADR 0005 D2, Q2)?

**Why it matters:** determines how sheal captures cloud agents (claude.ai/code,
CI, scheduled routines) it can't reach by filesystem. Deferred until the local
path is proven, but it shapes the adapter interface.
- API/webhook-first → richest capture, but vendor-specific and may be absent in
  headless runs.
- git/PR-trail-only floor → always available, but low fidelity (loses trajectory).
- Fallback chain (API → webhook → git) → most robust, most surface area.

**Still open:** which concrete types are remote-only, and the exact fallback
order when an API is unavailable.

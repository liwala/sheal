# ADR 0005 — Capturing Sandboxed Sessions

**Status:** Proposed
**Date:** 2026-06-09
**Authors:** Luisa Lima (with brainstorming assistance from Claude)
**Builds on:** ADR 0001 (Layer 0 — capture window)
**Interacts with:** the `sandshell` skill (sandbox + Bash-guard policy)

## Context

ADR 0001 observes that sessions are "agent-managed and lossy" — host agents
prune their own state, so the window for extraction is bounded by session
lifetime. Sandboxed sessions take this to the limit: the entire working
environment is **torn down at session end**. Anything not exfiltrated before
teardown is gone — not pruned-later, but destroyed.

This is not hypothetical; it is the environment sheal itself runs in. In a
sandboxed Claude Code session:

- lifecycle hooks fire (`SessionStart` runs at startup; `Stop` / `SessionEnd`
  run at completion)
- the filesystem grants writes only to an allowlist (e.g. the repo, a temp dir
  like `/tmp/claude`, `.claude/debug`)
- **network egress is restricted to a host allowlist** — arbitrary outbound
  connections fail

The volatility axis from ADR 0001's source model is at its extreme here, and it
interacts badly with the locality axis: the obvious capture mechanism (push
artifacts to a remote sheal store) is exactly what the sandbox's network policy
is designed to prevent. Capture has to work *with* the sandbox's constraints,
not around them.

The artifacts worth rescuing before teardown are the same ones ADR 0001 and ADR
0004 care about: the transcript, the git diff (a "guaranteed survivor" per ADR
0001 — but only if committed/pushed), and any in-flight agent memories.

## Decision

**Capture sandboxed sessions via lifecycle hooks, writing to a host-persistent
location by default; treat any network egress for capture as an explicit,
audited exception to the sandbox policy — never a bypass.**

### D1. Hooks are the capture seam

A `Stop` / `SessionEnd` hook invokes `sheal capture` before the sandbox is torn
down. This reuses an existing, already-firing mechanism rather than introducing
a daemon or background watcher inside the sandbox. The hook is responsible only
for *getting artifacts to durable storage* — sorting/consolidation (ADR 0001's
later stages) happens later, outside the sandbox.

### D2. Pull model by default (host-persistent mount)

Prefer writing captured artifacts to a path that survives teardown — a mounted
volume or host-shared directory that the sandbox can write to and a host-side
sheal process later reads. This avoids depending on network egress that the
sandbox may block, and keeps capture working in the most locked-down profiles.

### D3. Egress is an explicit, audited exception

When a host-persistent mount is unavailable and artifacts must leave over the
network, that egress must be a **declared exception in the sandbox policy**
(the domain that sheal pushes to is allowlisted), logged in the sandshell audit
trail. Capture must not require, encourage, or provide a way to relax the
sandbox's general egress posture. The capture path is the *one* sanctioned exit;
everything else stays denied.

### D4. Minimal capture set under time pressure

Teardown gives a bounded, possibly very short window. Define a priority order so
a truncated capture still saves the highest-value, least-recoverable material
first:

1. git diff / uncommitted changes (lost entirely on teardown if not saved)
2. in-flight agent memories and self-authored artifacts (per ADR 0004)
3. the session transcript (often the largest; lowest priority because the host
   may retain a copy)

## Consequences

**Positive**

- Reuses the existing hook contract; nothing new runs *inside* the sandbox
  beyond a single capture invocation.
- The pull-model default keeps capture functional in maximally restricted
  sandboxes where egress is fully denied.
- Framing capture egress as a single audited exception keeps it compatible with
  `sandshell`'s defense-in-depth posture instead of fighting it.

**Negative / costs**

- The capture hook must be installed in every sandbox image / profile; an
  un-instrumented sandbox captures nothing.
- Tight coupling to each host harness's hook contract — `Stop`/`SessionEnd`
  semantics differ across Claude Code, Codex, and CI runners.
- A host-persistent mount is itself a privilege; in some environments it is no
  more available than egress, forcing the D3 exception path.
- Security surface: the sanctioned capture exit is, by construction, an exfil
  channel. It must be narrow, audited, and reviewed against sandshell policy.

## Open questions

- **Q1.** Mount vs. egress as the *default* — does it vary by environment, and
  who decides per profile?
- **Q2.** What is the exact minimal capture set, and how is the priority order
  enforced when the teardown window is too short to finish?
- **Q3.** How do we capture from a **crashed or killed** sandbox where no clean
  `Stop` hook ever fires? (Periodic mid-session checkpointing? Out of scope?)
- **Q4.** How does the capture hook authenticate to the host-persistent store
  without embedding long-lived credentials inside the sandbox?
- **Q5.** Relationship to ADR 0004's git-diff capture and ADR 0006's cloud
  capture — is sandbox capture just "local capture with a deadline," or does it
  need its own artifact format?

## First step (validation milestone)

Add a `SessionEnd` (or `Stop`) hook in this repo that, on session end, writes
the git diff + agent memory files + transcript pointer to a host path outside
the sandbox's ephemeral tree. Run a session, let it end, and confirm the
artifacts **survive teardown** and are readable from the host afterward.

Acceptance criteria:

- If the artifacts are present and complete on the host after the sandbox is
  gone, the hook-based capture seam is validated and this ADR proceeds.
- If teardown races the hook or the host path is unreachable from inside the
  sandbox, the pull-model assumption (D2) is wrong for this environment and the
  ADR is revised toward the egress-exception path (D3) before further work.

## References

- ADR 0001 — Sheal as a Knowledge Consolidation System (§ Context obs. #1,
  § Trigger taxonomy → "sleep" / session-end)
- ADR 0004 — Artifacts as First-Class Sources (in-flight agent memories)
- `sandshell` skill — sandbox configuration, Bash guard hooks, audit logging

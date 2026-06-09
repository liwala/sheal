# ADR 0005 — `sheal pull`: Acquisition Adapters for Sandboxed and Cloud Sessions

**Status:** Proposed
**Date:** 2026-06-09
**Authors:** Luisa Lima (with brainstorming assistance from Claude)
**Builds on:** ADR 0001 (Layer 0 — the capture window)
**Relates to:** ADR 0004 (artifacts as sources)
**Interacts with:** the `sandshell` skill (sandbox + Bash-guard policy)

## Context

ADR 0001 observes that sessions are "agent-managed and lossy" — host agents
prune their own state, so the window for extraction is bounded by session
lifetime. Two cases push this to the limit:

- **Sandboxed sessions** are torn down at session end. Anything not exfiltrated
  before teardown is *destroyed*, not merely pruned. The sandbox also restricts
  network egress to a host allowlist, so the obvious "push artifacts to a remote
  store" move is exactly what the sandbox is designed to prevent.
- **Cloud agents** (claude.ai/code, scheduled routines, CI agents) keep their
  sessions on vendor infrastructure that sheal usually **cannot reach** at all.

These look like two problems but they are one: *how does sheal acquire episodic
material from an execution environment it does not own and may not be able to
reach?* That is precisely the "Capture" stage ADR 0001 defines and the verb it
already uses for it — "**pull** recent episodic material before host-agent
pruning makes the lift expensive."

### Rejected alternative: in-sandbox push hook

An earlier draft of this ADR put a `Stop` / `SessionEnd` hook *inside* the
sandbox to push artifacts out at teardown. Rejected because:

1. it requires instrumenting every sandbox image — an un-instrumented sandbox
   captures nothing;
2. it requires an egress exception from inside the sandbox, which is the exact
   exfil channel `sandshell` exists to prevent — capture would be fighting the
   security posture;
3. it puts the *agent inside the box* doing the work, which inverts ADR 0001's
   model where sheal is the outer layer that moves knowledge across stores it
   does not own.

## Decision

**Acquisition is a host-side pull verb backed by per-environment adapters:**

```
sheal pull <sandbox-type> <sandbox-name>
```

The host reaches into (or queries) the environment and pulls episodic material
out, under host control. The environment never initiates anything outbound.

### D1. Host-initiated, verb-shaped

`sheal pull` is a first-class verb alongside ADR 0001's
consolidate/promote/demote/forget/review/trace. It names the Capture stage.
Timing is decoupled from session lifecycle — pull on demand, on a schedule
(ADR 0001's "schedule" trigger), or as a host teardown step (D4).

### D2. Per-type adapters, in two reachability tiers

`<sandbox-type>` selects an adapter; `<sandbox-name>` identifies the instance.
Adapters fall into two tiers by how much the host can reach:

- **Direct-FS adapters** — local sandboxes (`docker`, `devcontainer`,
  `claude-sandbox`, `vm`). The host reads the sandbox filesystem and logs
  directly (exec / cp / mounted volume). Full-fidelity pull: diff, memories,
  transcript.
- **Remote adapters** — cloud/managed environments (`claude-cloud`, `ci`,
  scheduled routines). The host cannot read the filesystem. The adapter falls
  back, in order, to: vendor sessions API → session-complete webhooks → the
  **git/PR trail**, which ADR 0001 names as the guaranteed survivor and is
  always available because cloud agents push to git.

This collapses the old "locality axis" into "which adapter," and folds what
would have been a separate cloud-capture ADR into this one.

### D3. No in-sandbox instrumentation, no egress hole

Because data flows host ← environment under host control, nothing runs inside
the sandbox and no outbound egress is opened from inside it. The sandbox stays
fully locked down; the `sandshell` posture is preserved rather than excepted.
This is the decisive advantage over the rejected push-hook design.

### D4. Persistence / timing is the real constraint

For `sheal pull` to find anything, the environment **or a durable footprint of
it** must be reachable when the command runs. This is satisfied by one of:

- **Retention** — sandboxes keep their filesystem/logs after the session ends;
  pull runs post-hoc. This also handles the *crashed sandbox* case: if the
  footprint survives, a clean shutdown was never required.
- **Host teardown step** — the host orchestrator invokes `sheal pull` as part
  of its own teardown sequence (host-side, not an in-sandbox hook).

For remote adapters this is free (the vendor retains the session). For local
sandboxes it is a deployment requirement this ADR makes explicit. A
fully-destroyed sandbox with no footprint and no host teardown hook is
**out of reach** — and the ADR says so rather than pretending otherwise.

### D5. Fidelity and the minimal capture set

Adapters pull, in priority order: git diff / uncommitted changes → in-flight
agent memories and self-authored artifacts (per ADR 0004) → session transcript.
Remote adapters that can only reach git capture the *lowest* fidelity — they
lose the trajectory (mistake → correction) ADR 0001 says makes sessions
valuable. When an adapter captures a reduced set, it **logs the gap** rather
than silently presenting partial capture as complete.

### D6. Provenance is stamped at pull time

Every pull stamps source identity — `<sandbox-type>`, `<sandbox-name>`, and a
session/run id — onto the captured material. This directly discharges ADR 0001's
open question Q5 (attributing a learning to "Claude in session X" vs. "Codex in
session Y"): the attribution is recorded by the adapter that pulled it.

## Consequences

**Positive**

- Aligns with ADR 0001's verb-not-noun model and reuses its "pull" vocabulary.
- Zero in-sandbox instrumentation; sandboxes need not cooperate or know sheal
  exists.
- No egress hole — capture stops fighting `sandshell`.
- One adapter abstraction spans local sandboxes and cloud, so new environments
  are new adapters, not new architectures.
- Pull-time provenance stamping closes ADR 0001 Q5.

**Negative / costs**

- One adapter per environment type; each backend has its own access mechanism
  (docker exec, mount, vendor API, git).
- Requires a retention policy or a host teardown hook for local sandboxes —
  a deployment constraint that did not exist before.
- Remote/git-only adapters are low fidelity; some sessions will be captured as
  diffs without their trajectory.
- Discovery: the host must be able to enumerate and name pullable environments.

## Open questions

- **Q1.** Discovery — how does `sheal pull` enumerate available environments
  (`sheal pull --list`?), and how are names assigned/resolved per type?
- **Q2.** Which concrete types are direct-FS vs. remote-only, and what is the
  fallback chain when a remote adapter's API is unavailable in a headless run?
- **Q3.** Retention — who sets sandbox retention, how long, and how is the
  footprint garbage-collected after a successful pull?
- **Q4.** Authentication — how does an adapter authenticate to a vendor API or
  a host docker socket without embedding long-lived credentials?
- **Q5.** Dedup — when the same session is captured both by a local pull and via
  its cloud PR, how do we count it once (ties to ADR 0004 Q2)?
- **Q6.** Truly destroyed environments with no footprint and no teardown hook —
  accepted as out of reach, or worth periodic mid-session checkpointing?

## First step (validation milestone)

Implement **one direct-FS adapter** end-to-end — `sheal pull docker <name>` (or
`sheal pull claude-sandbox <name>`) — that pulls git diff + agent memory files +
transcript from a *retained / stopped* sandbox into sheal's store with
provenance stamped. Then sketch **one remote adapter** that reconstructs a
session from its git/PR trail alone, to measure the fidelity floor.

Acceptance criteria:

- If the direct-FS pull recovers the artifacts from a retained sandbox with
  correct provenance, the host-pull model is validated and this ADR proceeds.
- If retention turns out unavailable in the target sandbox and no host teardown
  hook can invoke pull in time, D4 is wrong for that environment and the ADR is
  revised (e.g. reconsider a minimal host-side teardown trigger) before further
  adapter work.
- The git-only remote sketch quantifies the trajectory loss (D5), informing
  whether remote adapters need more than git.

## References

- ADR 0001 — Sheal as a Knowledge Consolidation System (§ Capture / "pull",
  § Trigger taxonomy, Q5 cross-agent provenance, git as guaranteed survivor)
- ADR 0004 — Artifacts as First-Class Sources (in-flight memories, dedup Q2)
- `sandshell` skill — sandbox configuration, Bash guard hooks, audit logging

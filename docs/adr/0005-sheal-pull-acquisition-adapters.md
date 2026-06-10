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

### Scope: initial implementation (local-first)

The first cut targets **local runtimes only**; the remote/cloud tier of D2 is
deferred until the local path is proven.

- **Discovery — `sheal pull --list`.** Enumerates local runtimes —`docker`,
  `lima`, `orbstack`, docker-based sandboxes — and, under each, the running
  containers/instances it can reach. `<sandbox-type> <sandbox-name>` are picked
  from that listing. (Resolves Q1.)
- **Runtime-native access, no credentials.** Local adapters read artifacts using
  the runtime's own capabilities — e.g. `docker cp` / `docker exec` and the
  `lima` / `orbstack` equivalents — not vendor APIs or stored secrets.
  (Resolves Q4 for the local case.)
- **Captured material lands in a dedicated staging folder**, separate from
  sheal's consolidation store, with a sheal setting to configure its location
  (and, later, retention). Pull is acquisition only; ADR 0001's consolidation
  reads from staging afterward. (Resolves Q3 for now.)
- **Crashed / destroyed environments → mid-session checkpointing.** Beyond
  pulling at/after session end, sheal can checkpoint on an interval so a killed
  sandbox still leaves a recent footprint. This is the likely home for a future
  **sheal daemon** — but the first cut stays simple (on-demand `sheal pull`),
  with checkpointing added incrementally. (Directional answer to Q6.)

### Implementation note: shipped local slice

As of the local Docker adapter slice, the shipped command surface covers `sbx`
and Docker-backed local acquisition:

- `sheal pull --list` discovers local `sbx` sandboxes and Docker containers.
- `sheal pull sbx <name>` captures one sandbox's git diff, agent artifacts,
  memory files, and transcript into `.sheal/pulls/sbx/<name>/<timestamp>/`
  with pull-time provenance and gap logging.
- `sheal pull sbx --all` captures every listed `sbx` sandbox that has an
  available workspace and skips entries whose workspace is missing.
- `sheal pull docker <name>` captures one selected Docker container's git diff,
  agent artifacts, memory files, and transcript into
  `.sheal/pulls/docker/<name>/<timestamp>/` with container provenance and gap
  logging.
- `sheal pull docker --all` is intentionally unsupported; Docker container
  selection is human-driven from `sheal pull --list`.

Still deferred: remote/cloud adapters, retention and garbage collection, and
daemon/checkpointing behavior.

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

Resolved for the local-first cut (see § Scope): Q1 discovery (`--list`),
Q3 staging folder + setting, Q4 runtime-native access, Q6 (direction:
checkpointing, later a daemon). Remaining:

- **Q2 (deferred).** The remote/cloud tier — which concrete types are
  remote-only, and the fallback chain (vendor API → webhook → git/PR) when an
  API is unavailable in a headless run. Out of scope until local is proven.
- **Q3a.** Staging retention/GC — how long captured material lives in the
  staging folder, and how it is cleaned up after consolidation has read it.
- **Q5 (deferred).** Dedup across capture paths — once remote adapters exist, a
  session captured both by local pull and via its cloud PR must count once
  (ties to ADR 0004 Q2). Moot while local-only.
- **Q6a.** Checkpointing/daemon design — interval, what a checkpoint captures
  vs. a full pull, and whether the daemon is opt-in per runtime.

## First step (validation milestone)

Local-first, two pieces:

1. **`sheal pull --list`** — enumerate local runtimes (`docker`, `lima`,
   `orbstack`, docker sandboxes) and the running containers under each.
2. **One direct-FS adapter** end-to-end — `sheal pull docker <name>` — that uses
   `docker cp` / `docker exec` to pull git diff + agent memory files + transcript
   from a running (or retained) container into the staging folder, with
   provenance stamped.

Acceptance criteria:

- If `--list` shows real runtimes + containers and `sheal pull docker <name>`
  lands the artifacts in staging with correct provenance, the host-pull model is
  validated and this ADR proceeds.
- If runtime-native access can't reach the artifacts (e.g. nothing useful at the
  expected paths inside the container), the minimal-capture assumption (D5) is
  revised before adding more adapters.

## References

- ADR 0001 — Sheal as a Knowledge Consolidation System (§ Capture / "pull",
  § Trigger taxonomy, Q5 cross-agent provenance, git as guaranteed survivor)
- ADR 0004 — Artifacts as First-Class Sources (in-flight memories, dedup Q2)
- `sandshell` skill — sandbox configuration, Bash guard hooks, audit logging

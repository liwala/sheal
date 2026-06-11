# ADR 0004 — Artifacts as First-Class Sources

**Status:** Proposed
**Date:** 2026-06-09
**Authors:** Luisa Lima (with brainstorming assistance from Claude)
**Builds on:** ADR 0001 (source/capture layer and consolidation pipeline)

## Context

ADR 0001 names *sessions* as the corpus and assumes sheal performs the
episodic → semantic distillation itself (`sheal retro` mining a transcript into
`LEARN-###` items). That assumption is increasingly wrong.

Agents now self-distill *in-flight*. They write knowledge artifacts directly:

- `bd remember` entries (beads memory store)
- auto-memory files (`MEMORY.md` and the per-memory files under the project's
  memory directory)
- self-authored skills (`.claude/skills/`, and whatever sheal's own store grows
  into per ADR 0001 D1)
- edits to the schema layer itself — `CLAUDE.md`, `AGENTS.md`
- plan files, TODO lists, scratch notes

These artifacts sit at **higher fidelity** than raw transcripts: they are
already partially consolidated. But they have no shared provenance, no decay,
and — critically — they **contradict each other**.

This repo contains a live instance of the source-fragmentation problem, though
the exact stores are runtime-dependent. `AGENTS.md` carries the flat
`LEARN-###` list, host memory systems may expose `MEMORY.md` or per-memory
files, task/plan files accumulate decisions, and local-only stores such as
beads may exist outside tracked files. No single one is inherently the source of
truth, and nothing reconciles them.

ADR 0001's pipeline (capture → sort → compare → decide → apply → reflect)
implicitly assumes its inputs are *raw*. Feeding it semi-distilled artifacts as
if they were transcripts would re-distill already-distilled knowledge, lose the
agent's own structuring work, and miss the real job — which is no longer
distillation but **reconciliation**.

## Decision

**Treat artifacts as first-class sources, distinct from sessions, and classify
sources by fidelity.**

### D1. A fidelity axis on sources

Every source declares (or sheal infers) a fidelity level that determines where
it enters the consolidation pipeline:

- **Raw** — transcripts, terminal scrollback, git diffs. Enter at *capture*;
  full distillation applies. (ADR 0001's assumed input.)
- **Semi-distilled** — agent-authored memories, plan files, TODO lists. The
  agent already did the episodic → semantic step. These **skip distillation**
  and enter at *compare* (against existing wiki/skills).
- **Distilled** — self-authored skills, schema edits. Already in
  procedural/schema form. Enter at *compare* and *decide* only; the question is
  promotion/merge/contradiction, never re-extraction.

### D2. Sheal's job expands from *distill* to *reconcile*

For semi-distilled and distilled sources, the primary operation is
reconciliation across stores that don't know about each other:

- **detect contradiction** — store A says X, store B says not-X
- **dedup** — the same learning expressed multiple ways across multiple stores
- **attach provenance** — most artifacts arrive without `first-seen` / `sources`
  (ADR 0001 §Provenance); sheal backfills it from the artifact's git history or
  containing session where recoverable

Reconciliation is a new verb in the ADR 0001 verb model (consolidate, promote,
demote, forget, review, trace) — call it `reconcile`.

### D3. Artifacts are read-only sources, not stores sheal owns

Consistent with ADR 0001's posture (sheal moves knowledge across stores it does
not own), sheal reads artifacts and emits reconciled output into its *own* wiki/
skill store. It does **not** mutate source stores such as `bd remember`,
`MEMORY.md`, or `.claude/skills/` in place by default. Whether reconciliation
should ever write back to a source store is an open question (Q3 below).

## Consequences

**Positive**

- A sharper differentiation than ADR 0001 alone: not "we mine sessions like
  everyone mines documents," but "we reconcile the competing memory stores your
  agents already generate." The fragmentation is real in this workflow even
  when some stores are host-local rather than tracked repo files.
- The fidelity axis prevents the re-distillation failure mode (re-chewing
  already-distilled knowledge and degrading it).
- Provenance backfill gives semi-distilled artifacts the decay/confidence
  machinery ADR 0001 defines, which they currently lack.

**Negative / costs**

- One adapter per artifact type (beads, auto-memory, skills, schema). Each store
  has its own format and lifecycle.
- Fidelity must be inferred when not declared — misclassification sends an
  artifact into the wrong pipeline stage.
- A conflict model is now required: when stores contradict, which wins, and what
  escalates to `sheal review` versus auto-resolving.

## Open questions

- **Q1.** How is fidelity determined — declared per source adapter, or inferred
  from structure? What is the failure behavior on misclassification?
- **Q2.** How do we dedup a semi-distilled item against a raw session that
  produced it, so the same learning captured both ways counts once? Tracked as
  `docs/tasks/q2-cross-path-dedup.md`; still open until sheal has a stable
  session/run identity or a highest-fidelity-wins merge rule.
- **Q3.** Does `reconcile` ever write back to a source store (e.g. collapse two
  contradictory `bd remember` entries), or only ever emit into sheal's wiki?
  Write-back breaks the read-only posture but may be what users want.
- **Q4.** Provenance backfill: how far can `first-seen`/`sources` be recovered
  from an artifact's git blame when the originating session is already pruned?

## First step (validation milestone)

Point sheal at the currently available source stores for this repo — the
`AGENTS.md` `LEARN-###` list, host memory files when available, local memory
stores such as beads when present, and task/plan artifacts — and emit a single
**contradiction / overlap report**:

- pairs of items that say opposing things
- clusters of items that say the same thing in different stores
- items with no recoverable provenance

Acceptance criteria:

- If the report surfaces real contradictions or duplicates across the available
  stores, the reconciliation frame is validated and this ADR proceeds.
- If the available stores turn out to be cleanly disjoint with no conflicts, the
  reconciliation thesis is weaker than claimed and this ADR is revised toward a
  simpler "additional read-only sources" framing before any adapter work.

## References

- ADR 0001 — Sheal as a Knowledge Consolidation System (§ source layer,
  § Provenance and decay, verb model)
- ADR 0005 — `sheal pull`: Acquisition Adapters for Sandboxed and Cloud
  Sessions (artifact capture and cross-path dedup pressure)
- Competing stores in this workflow: `AGENTS.md` § Session Learnings, host
  memory files, local memory stores when present, task/plan artifacts

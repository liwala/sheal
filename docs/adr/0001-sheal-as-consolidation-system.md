# ADR 0001 — Sheal as a Knowledge Consolidation System

**Status:** Proposed
**Date:** 2026-05-07
**Authors:** Luisa Lima (with brainstorming assistance from Claude)

## Context

The "memory for agents" space is crowded. Most systems are flat fact stores
with vector retrieval — append-only journals optimized for recall. They do not
distinguish between *what happened*, *what we know*, and *how we should act*;
they have no notion of decay, provenance, contradiction, or promotion of
patterns into behaviors.

Sheal already does something the field mostly doesn't: it mines *sessions*
(rich, trajectory-bearing logs of agent work) and produces `LEARN-###` items
with triggers, currently appended to `AGENTS.md`. As of this writing there are
~30 such items, flat and ungrouped.

Two observations sharpen the design problem:

1. **Sessions are the corpus, but they are agent-managed and lossy.** Claude,
   Codex, and other host agents prune their own session state after the fact.
   The window for extraction is bounded by session lifetime, and side-channels
   (transcripts, git history, terminal logs, file diffs) are the only things
   guaranteed to survive.
2. **Karpathy's LLM Wiki proposal**
   ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f))
   models a 3-layer system — raw sources, an LLM-maintained markdown wiki, and
   a co-evolved schema (`CLAUDE.md`) — with three operations: ingest, query,
   lint. The key unlock: LLMs make bookkeeping cost near zero, so the wiki
   actually stays maintained.

Karpathy's framing is right but incomplete for sheal's domain:

- His sources are documents (papers, articles); ours are sessions, which have
  *trajectory* (mistake → correction → recovery). Mining a session is closer to
  mining a git log than summarizing prose.
- His wiki is *passive* (Q&A with citations). Sheal's job is *active* — the
  agent needs to behave differently next session, not just answer questions
  better. That requires a stage Karpathy doesn't have: skills compiled from
  wiki pages, with triggers.

## Decision

**Reframe sheal as a knowledge consolidation system, not a memory system.**

Sheal does not own the underlying stores — sessions live in Claude/Codex/etc.,
code lives in git, terminal output lives in scrollback. Sheal is a layer that
*moves and transforms knowledge across stores other systems own*. The product
surface is **verbs**, not nouns: consolidate, promote, demote, forget, review,
trace.

This is the actual differentiation from "everyone is doing memory." Most
systems build stores. Sheal builds the operations that move knowledge between
them.

### 4-layer architecture

1. **Sources / raw sessions** — immutable episodic material (transcripts,
   retros, git diffs). Sheal reads but never owns these. ADR 0004 extends this
   source layer to include agent-authored artifacts with explicit fidelity
   levels.
2. **Wiki** — structured topic pages distilled from many sessions, with
   backlinks to contributing sessions. Sheal-maintained, browsable, decaying.
3. **Skills** — triggered behaviors compiled from wiki topics. "When X, do Y."
4. **Schema** — `CLAUDE.md` / `AGENTS.md`, co-evolved with the wiki, defining
   organization and conventions.

ADR 0005 implements the Capture stage as host-side `sheal pull` acquisition for
sandboxed and cloud sessions. It preserves this ADR's "sheal moves knowledge
across stores it does not own" model by keeping data flow host-initiated.

### Cognitive-science alignment

The 4 layers map to known memory types:

- Sessions ≈ **episodic** (what happened, when, with what context)
- Wiki ≈ **semantic** (distilled topical knowledge)
- Skills ≈ **procedural** (triggered behavior, fires without deliberation)
- Schema ≈ **organizational schema** (where new things go)

Operations map to memory processes:

- **Encoding** — capture during the session window, before host-agent pruning
- **Consolidation** — episodic → semantic/procedural (what `sheal retro` does)
- **Reconsolidation** — every read of a wiki page is a write opportunity if it
  turns out stale
- **Forgetting curve** — pages decay without rehearsal; lint is a rehearsal
  schedule, not a one-shot health check

### Design decisions

**D1. Skills live in sheal's own store** (e.g. `.sheal/skills/` per project,
`~/.sheal/skills/` global), not in `.claude/skills/`.

*Rationale:* Sheal needs to support multiple host agents (Claude, Codex,
Cursor, Amp). Binding skill storage to one runtime's format gives up
portability. Sheal-owned skills can be *compiled* to runtime-specific surfaces
(Claude skills, Codex prompts, etc.) by emitters — this preserves the verb
model where sheal moves knowledge into stores it doesn't own.

**D2. The wiki is both per-project and global.**

*Rationale:* Per-project wikis ground knowledge in a real codebase (file paths,
domain concepts, project-specific failure modes survive review). A global wiki
captures cross-project patterns — most existing `LEARN-###` items in
`AGENTS.md` are cross-project, not codebase-specific.

There is an explicit promotion step: a project-level page that recurs across
projects becomes a candidate for global. A global page that turns out to be
project-specific gets demoted. Promotion is a sheal verb, not a copy-paste.

```
.sheal/wiki/         # per-project topic pages
.sheal/skills/       # per-project compiled skills
~/.sheal/wiki/       # global topic pages (cross-project patterns)
~/.sheal/skills/     # global compiled skills
```

### Consolidation phases

A consolidation pass has stages, like sleep does:

1. **Capture** — pull recent episodic material before host-agent pruning makes
   the lift expensive
2. **Sort** — by topic, by agent runtime, by trigger type
3. **Compare** — against existing wiki/skills (contradicts, extends, restates?)
4. **Decide** — promote / merge / surface-as-contradiction / demote / let-decay
5. **Apply** — write changes, update links, stamp provenance
6. **Reflect** — escalate ambiguous calls to a queue the user drains later

Each pass produces a *change set*, not a snapshot. Dry-runnable, reviewable,
idempotent.

### Trigger taxonomy

Consolidation fires from multiple triggers, not just session-end:

- **Sleep** — end of session (`sheal retro` today)
- **Rehearsal** — wiki page read during query; touch updates freshness; finding
  it stale is a write opportunity
- **Crisis** — user said "no", agent looped, build failed N times — high-signal
  moments worth marking immediately
- **Schedule** — periodic cron pass for decay sweep over cold pages
- **Volume** — after N sessions on the same topic, force a distillation

Different triggers feed different stages. Crisis goes straight to capture +
surface. Schedule does decay. Sleep runs the full pipeline.

### Provenance and decay

Every wiki page and skill carries:

- `first-seen` — session ID where the pattern first emerged
- `last-rehearsed` — last time the page was read or referenced
- `sources` — links to contributing sessions (the episodic raw material)
- `confidence` — derived from how many sessions have reinforced the pattern

Decay is not a hard delete. Stale pages get flagged for rehearsal; if not
rehearsed, they move to an archive tier rather than being lost.

### User-in-the-loop, selectively

Most consolidation runs automatically. Contradictions, dead skills, and
ambiguous merges escalate to a *queue the user drains* (`sheal review`), not a
blocking prompt mid-flow. Memory systems feel intrusive when they interrupt;
consolidation should batch.

## Consequences

**Positive:**

- Sheal's differentiation is operational (consolidation as a service) rather
  than yet-another-memory-store competing on retrieval quality.
- The verb-not-noun framing aligns with sheal's existing posture (a CLI of
  commands acting on agent state) rather than fighting it.
- 4-layer model with provenance and decay addresses the "stale memory poisons
  retrieval" failure mode visible in current systems.
- Runtime-agnostic skill format means sheal can grow to support agents beyond
  Claude without rewriting the knowledge layer.

**Negative / costs:**

- Compilers/emitters need to be built per host agent. Each new runtime is real
  work, not free.
- Two-tier wiki (project + global) requires explicit promotion logic — more
  surface area than a single store.
- Decay scheduling and rehearsal require persistent state beyond what sheal
  currently keeps.
- Backwards compatibility: the existing flat `LEARN-###` list in `AGENTS.md`
  needs a migration path into the topic-page model.

**Follow-up questions:**

- Q1. Skill format — what is the runtime-agnostic schema? What compiles to
  what? (See potential ADR 0002.)
- Q2. Storage layout details — file-per-page Markdown vs. SQLite vs. Dolt for
  the wiki layer. Sheal already uses Dolt elsewhere.
- Q3. Promotion algorithm — what threshold moves a project page to global?
  Manual, automatic with confirmation, or fully automatic?
- Q4. Rehearsal scheduling — fixed intervals, exponential backoff, or
  retrieval-frequency-driven?
- Q5. Cross-agent provenance — ADR 0005 answers this for material acquired by
  `sheal pull` by stamping source identity at pull time. Skill-emitter
  provenance still needs to be covered by the runtime-agnostic skill format.

## First step (validation milestone)

Before building any of the above, run a one-shot consolidation pass over the
existing 30 `LEARN-###` items in `AGENTS.md` to test whether the layering is
real. Output:

- 4–6 candidate topic pages
- Each `LEARN` linked to its originating session (provenance)
- `first-seen` timestamps on each
- A list of "contradictions or near-duplicates I noticed," surfaced for review

Acceptance criteria:

- If the topic pages feel useful and the contradictions list is non-empty, the
  consolidation frame is real and this ADR proceeds toward Accepted.
- If the `LEARN`s resist topic grouping, the right unit is something other
  than "topic page" and this ADR is revised before any storage work begins.

This is cheap to run, falsifiable, and produces an artifact whose usefulness
the user can judge directly.

## References

- Karpathy, *LLM Wiki* gist:
  https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- ADR 0004 — Artifacts as First-Class Sources (source fidelity axis)
- ADR 0005 — `sheal pull`: Acquisition Adapters for Sandboxed and Cloud
  Sessions (host-side Capture)
- Existing `LEARN-###` corpus: `AGENTS.md` § Session Learnings
- Sheal's current retro pipeline: `src/` (entry point for `sheal retro`)

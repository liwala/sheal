---
status: doing
started: 2026-07-06
type: task
id: T11
deliverable: P0
created: 2026-07-06
links: ["docs/adr/0001-sheal-as-consolidation-system.md"]
---

# T11. Run the ADR 0001 validation milestone: consolidate the LEARN corpus

## Objective

Execute the one-shot consolidation pass over the existing LEARN corpus that
ADR 0001 defines as its gating "first step": test whether the topic-page
layering is real before building any wiki storage.

## What we need to extract / do

- Inventory `.sheal/learnings/` (including the duplicate-ID collisions present
  in the store) against the AGENTS.md flat list.
- Produce 4–6 candidate topic pages with member learnings and provenance.
- Produce a contradictions / near-duplicates list with merge proposals.
- Produce a per-learning disposition (keep / merge / retire) and classify each
  as prose rule vs mechanical (compilable to hook/checker).
- Review the output against ADR 0001's acceptance criteria and record the
  verdict (proceed to Accepted, or revise the unit of consolidation).

## Done when

- Candidate topic pages and the contradictions list exist as reviewable docs.
- ADR 0001 status is updated with the validation verdict.

## Output

docs/wiki-candidates/ (topic pages + contradictions list), ADR 0001 update.

## Dependencies

None.

# docs/tasks/ — work & decision tracking

This folder tracks both **execution tasks** and **open questions** using a flat
Markdown + YAML-frontmatter convention. One file per item; the item's `type`
frontmatter field distinguishes a task from a question. Manage it with the
`/opentasks` skill — don't hand-create files, so the index stays in sync.

## How it works

- **One file per item.** Tasks use a descriptive kebab-case slug
  (`pull-list-command.md`); questions use `q<N>-<slug>.md` (`q1-remote-adapter-tier.md`).
- **Frontmatter is the source of truth.** `TASK_INDEX.md` is a *derived* view —
  if they disagree, the individual file wins. Rebuild the index with
  `/opentasks sync`.
- **Closed files are kept as history** — never deleted.

## Status values

| Status    | Tasks                   | Questions                          |
|-----------|-------------------------|------------------------------------|
| `todo`    | Not started             | Ready to ask / discuss             |
| `doing`   | In progress             | Not valid — use `blocked` or `done`|
| `blocked` | Waiting on a dependency | Waiting for an answer              |
| `done`    | Completed               | Answered                           |

## Types

- **task** — a unit of work, grouped by `deliverable` (e.g. `D1`, `D2`, `ops`).
- **question** — an open decision, grouped by `owner` (who must answer).

## Task body template

```markdown
---
status: todo
type: task
deliverable: D1
created: YYYY-MM-DD
---

# <Title>

## Objective
<One or two sentences — what this is and why it matters.>

## What we need to extract / do
<Concrete bullets describing the actual work.>

## Output
<What gets produced and where it feeds into. "none" if no tracked artifact.>

## Dependencies
<What must exist first.>
```

## Question body template

```markdown
---
status: todo
type: question
owner: <name-or-role>
created: YYYY-MM-DD
---

# Q<N>. <The question, phrased as a question>

**Why it matters:** <impact on design / scope>
- Branch A → consequence A.
- Branch B → consequence B.

**Still open:** <what remains unclear>
```

## Workflow

| Step     | Frontmatter change                                              |
|----------|----------------------------------------------------------------|
| create   | `status: todo`, `created:` set                                 |
| start    | `status: doing`, add `started:` (tasks only)                   |
| block    | `status: blocked`, add a `## Blocker` section                  |
| done     | `status: done`, add `closed:`; tasks add `output:` if any; questions record the answer inline |
| reopen   | `status: todo`, remove `closed:` (and `output:`); keep `started:` |

Closed items remain in the folder and in the index as history.

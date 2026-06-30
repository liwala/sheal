---
status: done
type: question
owner: Luisa
created: 2026-06-09
closed: 2026-06-09
---

# Q5. Which sandbox backend should ship first?

**Answered (2026-06-09, Luisa):** sbx first — treat Docker Sandboxes (`sbx`) as
the first sandbox backend. `sheal pull --list` discovers sandboxes from
`sbx ls --json`, and this introduced the pull naming
`sheal pull sbx <name>`.

At the time, raw docker-container discovery was deferred along with
lima/orbstack general-runtime adapters. Because `sbx` already exposes sandbox
records, D1 did not need a label/image/name heuristic to distinguish ordinary
Docker containers from agent sandboxes.

**Why it matters:** ADR 0005's `--list` names local runtimes broadly. Scoping the
first cut to an actual sandbox API keeps D1 useful without treating every Docker
container as an agent sandbox.

- sbx first → fastest path to agent-sandbox discovery with explicit sandbox
  fields.
- Raw docker/lima/orbstack adapters later → broader coverage, but only after
  there is a real need and a clear sandbox-identification contract.

**Updated direction (2026-06-10, Luisa):** implement sbx and raw Docker
end-to-end now. Docker uses human container selection from `sheal pull --list`
rather than agent-sandbox inference. Lima and OrbStack remain deferred.

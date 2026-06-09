---
status: done
type: question
owner: Luisa
created: 2026-06-09
closed: 2026-06-09
---

# Q5. Implement lima/orbstack adapters alongside docker, or docker-only first?

**Answered (2026-06-09, Luisa):** Sandboxes only for now — scope the first cut to
docker-based agent **sandboxes**. Defer lima/orbstack general-runtime adapters
until there's a real need. `--list` and the first adapter target the sandbox case
on the docker backend; lima/orbstack are revisited later.

> Follow-up to settle during D1: how a sandbox is identified among docker
> containers (image/label/name convention) so `--list` shows sandboxes rather
> than every running container.

**Why it matters:** ADR 0005's `--list` names docker, lima, and orbstack as local
runtimes. Scoping the first cut affects how soon `--list` is useful on non-docker
setups.

- Docker-only first → fastest to a working slice; `--list` shows only docker.
- All three at once → broader coverage, more inspection/adapters up front
  (orbstack often speaks the docker API; lima uses `limactl list`).

**Still open:** whether your day-to-day uses lima/orbstack enough to need them in
the first slice, or docker-first is fine.

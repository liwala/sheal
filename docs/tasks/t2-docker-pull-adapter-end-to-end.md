---
status: done
started: 2026-06-10
closed: 2026-06-10
type: task
id: T2
deliverable: D2
created: 2026-06-10
links: ["q5-lima-orbstack-scope.md"]
output: src/pull/adapters/docker.ts, src/pull/registry.ts, src/commands/pull.ts, test/pull-docker.test.ts, test/pull-list.test.ts
---

# T2. Docker pull adapter end-to-end alongside sbx

## Objective

Add raw Docker as a second local direct-FS pull backend while preserving the
existing sbx behavior. `sheal pull --list` should show Docker containers with
enough metadata for a human to choose one, and `sheal pull docker <name>` should
pull the selected container end to end.

## What we need to extract / do

- Use human selection as the Docker container selection contract: sheal lists
  Docker containers, but it does not infer which ones are agent sandboxes.
- Drive the CLI end to end with a fake `docker` binary for discovery, single
  pull, and the explicit-selection error paths.
- Implement a Docker adapter that captures the same ordered material as sbx:
  git diff, agent artifacts, memory files, and transcript where present.
- Stamp Docker provenance with backend/type/name, container identity, status,
  pulled time, source paths, and gaps.
- Keep sbx tests green and ensure `--list` can show both sbx and docker
  backends when both CLIs are available.

## Done when

- `sheal pull --list` reports both sbx sandboxes and Docker containers when
  both backends are available, with enough Docker metadata for a human to select
  the intended container.
- `sheal pull docker <name>` stages captured material under
  `.sheal/pulls/docker/<name>/<timestamp>/`.
- `sheal pull docker --all` is rejected or left unsupported unless a later
  explicit allowlist/selection mechanism is added.
- Missing optional capture paths are reported as gaps, matching sbx behavior.
- Build and tests are green.

## Output

Code: Docker adapter, adapter registry update, command/doc updates, and focused
E2E tests.

## Dependencies

Container selection contract answered 2026-06-10: human selects the Docker
container explicitly from `sheal pull --list`.

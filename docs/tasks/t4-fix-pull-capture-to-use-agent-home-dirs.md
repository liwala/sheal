---
status: done
started: 2026-06-11
closed: 2026-06-11
type: task
id: T4
deliverable: D2
created: 2026-06-11
links: [t2-docker-pull-adapter-end-to-end.md, t3-normalize-pulled-sessions-into-raw-session-registry.md]
output: src/pull/capture-set.ts, test/pull-capture.test.ts, test/pull-docker.test.ts, README.md, docs/adr/0005-sheal-pull-acquisition-adapters.md
---

# T4. Fix pull capture to use agent home dirs

## Objective
Correct the pull capture contract before raw session normalization. Runtime
pulls should capture the agent's home-directory evidence under `.claude` and
`.codex`, not report workspace-local files as required session evidence.

## What we need to extract / do

- Add end-to-end coverage for an sbx pull where the workspace lacks `AGENTS.md`
  and `MEMORY.md`, but the sandbox home contains Claude/Codex data.
- Stop reporting workspace-local project files as pull gaps.
- Keep transcript capture rooted in the runtime home directories:
  `~/.claude/projects/...` and `~/.codex/sessions`.
- Update task documentation that still describes workspace memory files as part
  of the pull capture contract.

## Done when

- `sheal pull sbx <name>` captures home `.claude` and `.codex` content without
  requiring workspace `AGENTS.md`, `MEMORY.md`, or `.sheal/session.jsonl`.
- Missing workspace-local project files are not listed as gaps.
- Existing sbx and Docker pull tests remain green.
- The pull task docs describe home-dir agent evidence instead of workspace
  memory files.

## Output

Code, tests, and docs for the corrected pull capture contract.

## Dependencies
Requires the T2 pull adapter work on this branch.

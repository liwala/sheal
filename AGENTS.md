# Agent Instructions

See also: @CLAUDE.md for Claude Code-specific instructions.

# Agent Operating Policy

## 1. TDD discipline — strict order

For any behavior with a clear, assertable contract (bug fixes, business logic,
API or CLI behavior):

1. Write the test that asserts the intent of the behavior.
2. Run the suite. Confirm the new test fails — for the right reason (not a typo,
import error, or unrelated failure).
3. Only then write the source that makes it pass.
4. Run the suite again. Confirm it goes green.

A regression test added *after* the source fix is NOT TDD: it never failed, so it
never proved the bug existed or that the fix addresses it. If you reach for the
source first, stop — WRITE THE FAILING TEST FIRST.

### The ONLY exception: spikes

For exploratory work where you don't yet know what the behavior should be (UI
layout, prompt engineering, data exploration, unfamiliar APIs): spike to learn in
a throwaway branch or scratch file, discard it, then TDD the real thing from
scratch.

Declare a spike *before* starting, never after to excuse missing tests:

1. State it up front: "Spike to learn X; I'll throw it away and TDD the real thing."
2. Isolate it — never mixed into the production change.
3. Show the discard before the real implementation lands.

An undeclared deviation is not a spike — it's skipped tests.

## 2. Tests assert intent

Tests assert intent (user-visible behavior), not implementation, and should
survive a refactor. If a test breaks on a rename or internal reshuffle, rewrite it
to assert observable behavior.

## 3. Never weaken a test to make it pass

Fix the code, never loosen an assertion, delete a case, or mock away the thing
under test to go green. If the test itself is wrong, say so and explain why before
changing it.

## 4. Version control

1. Commit locally as you go, with focused, meaningful messages.
2. Push only to a dedicated working branch — never to main or a shared branch.
Gate every push on a green suite and a clean linter; never push with failing
tests or lint errors.
3. Scan for staged secrets/credentials before pushing (the linter won't catch
these). In doubt, don't push — surface it.

## 5. Read before you write

Understand existing code and conventions before changing them. Match the patterns
already in the file or module rather than importing your own idioms.

## 6. Vertical slices

Produce slices that are demonstrable end-to-end at every step, however small — not
horizontal layers that do nothing on their own.

## 7. Testing the CLI

The durable check is an automated end-to-end test driving the CLI with real
arguments and I/O, asserting on exit codes and output. Keep a manual smoke test as
a sanity pass, but never as the only check.

## 8. When blocked or uncertain — stop and surface

Stop and ask, rather than guess, when:

1. You can't write a test that captures the intended behavior.
2. A test fails and you can't determine why.
3. Two requirements conflict.
4. A decision exceeds your confidence or would be expensive to reverse.
5. You see valuable work beyond what was asked — name it as a suggestion; don't
silently expand scope.

Surface blockers concisely: what you tried, what you need. A blocked agent that
asks beats an unblocked agent that guesses.

## 9. Build supporting tools

Create and document tools to stay autonomous, but:

1. Prefer existing tooling (standard library, established CLIs, project scripts)
over bespoke.
2. Build only after the same manual operation recurs several times.
3. Prefer a committed script in the repo over one-off tooling.
4. Flag any new third-party dependency for human sign-off.
5. Document each tool: what it does, how to run it, why it exists.

## 10. Definition of done

1. Suite green, linter clean (no failing or skipped tests, no lint errors).
2. Docs and ADRs updated where warranted.
3. Change committed and pushed to its working branch.
4. Result demonstrable end-to-end.

Don't stop short of this, and don't keep polishing past it.

## 11. Architectural Decision Records

Write an ADR when a decision is costly to reverse, constrains future choices, or
picks between viable alternatives a maintainer would question. Routine, reversible
choices don't need one. Keep them short: context, decision, alternatives,
consequences.

## 12. Use subagents

Prioritize subagents for investigation, research, and longer or separable tasks,
so the main context stays focused.

## Landing the Plane (Session Completion)

When ending a work session, satisfy the Definition of Done (§10) and the
version-control rules (§4). Concretely:

1. **Run quality gates** — tests, linter, build. The suite must be green and the
   linter clean before anything is pushed (§4.2, §10.1).
2. **Commit and push to the working branch** — never to main or a shared branch
   (§4.2); scan for staged secrets first (§4.3).
   ```bash
   git pull --rebase
   git push                 # working branch only, gated on a green suite
   git status               # confirm up to date with origin
   ```
3. **Clean up** — clear stashes, prune merged branches.
4. **Verify** — all intended changes committed and pushed.
5. **Hand off** — context for the next session.

If a quality gate is red or two requirements conflict, **stop and surface** (§8)
rather than pushing broken work — a green push gated on passing tests beats one
that strands a red build on the remote.

## Git Discipline

Commit after every logical change as a focused, atomic unit; don't accumulate
uncommitted work across features. Push per §4 — to the working branch, gated on a
green suite and a clean linter.

## Self-Healing Workflow

Run `sheal check` at the start of every session to catch environment issues early.
Run `sheal retro` at the end of sessions to extract learnings.


<!-- BEGIN SHEAL RULES -->
## Session Learnings
<!-- Run `sheal learn show <id>` for full context on any rule -->

### Parsing
- [LEARN-001] Before writing parsers for external data formats (JSON APIs, JSONL transcripts, config files), always inspect 2-3 real samples first using git show, curl, or cat.

### Cli
- [LEARN-002] When using an unfamiliar CLI tool for the first time, run <tool> --help and <tool> <subcommand> --help before attempting commands.

### Testing
- [LEARN-003] After creating test fixtures, verify they match the real data format by comparing structure side-by-side.

### Services
- [LEARN-004] When a background server process (dolt, postgres, redis) is required, add it to .self-heal.json requiredServices so sheal check catches it at session start.

### General
- [LEARN-005] When bootstrapping a new TypeScript CLI project, define the full directory structure and module interfaces in a plan before writing any implementation files — this prevents the file churn seen in index.ts (6x) and analyzers.ts (5x).
- [LEARN-006] Before parsing any external data format (Entire.io transcripts, API responses), fetch a real sample first and save it as a test fixture — do not write parsers against assumed schemas.
- [LEARN-007] When `sheal check` reports warnings (like untracked files or missing services), resolve them before proceeding — treat warnings as blockers, not informational.
- [LEARN-008] After `npm link` or global CLI installation, always run `npx tsc && sheal --help` to confirm the build is valid before testing new commands — this catches TypeScript compilation errors (like the top-level await failures) before they cascade.
- [LEARN-009] When a session involves both infrastructure setup (Dolt, Entire.io hooks) and feature development, complete and verify all infrastructure first in a dedicated phase before starting feature work — interleaving causes cascading failures when the infra isn't solid.
- [LEARN-010] When a session hits context compaction, stop adding new features.
- [LEARN-011] Before implementing a feature that touches >3 files, write out the file-level plan (which files change, what each change is) as a comment or task list, then execute — don't discover the design through repeated edits.
- [LEARN-012] When adding support for a new agent runtime (amp, codex), read its `--help` output and test one invocation manually before writing integration code — the amp stdin requirement and codex flags caused multiple failure loops.
- [LEARN-013] After context compaction, re-read the 3 most-recently-edited files before resuming work — don't assume prior file contents are still in context.
- [LEARN-014] When building a TUI/browser view, get one screen working end-to-end before adding navigation between multiple screens — the browse feature required extensive back-and-forth on formatting issues that compounded across views.
- [LEARN-015] When fixing Go compilation errors involving `syscall` or OS-specific packages, immediately check whether the code needs build tags or is being cross-compiled — run `go env GOOS GOARCH` in the target environment before editing.
- [LEARN-016] After editing a Go file, run `go build ./...` or `go vet ./...` on that specific package before moving to the next file — do not batch multiple fixes and compile once at the end.
- [LEARN-017] When working inside a container or VM, run `cat /etc/os-release && which sudo docker git` as the first command to inventory the environment — do not assume any tool exists.
- [LEARN-018] If a Read or Bash tool fails twice with the same error, do not retry the same call — instead, explain the blocker and try an alternative approach (different tool, different file, ask the user).
- [LEARN-019] When a retro session's input data is incomplete (e.g., assistant responses truncated, no tool errors, no file list), note the gaps explicitly rather than generating analysis from thin air.
- [LEARN-020] When running `/retro` on a prior session, verify the checkpoint data loaded completely before producing analysis — truncated session data yields hollow retros.
- [LEARN-022] When a session has already touched 5+ files, refuse to start a new feature without first committing current work and listing the files the new feature will touch.
- [LEARN-024] When building an interactive TUI flow with multiple states (review → edit → confirm → delete), define the full state machine (states + transitions) before writing any code, to avoid retrofitting states like "draft" or "ESC to cancel" after the fact.
- [LEARN-025] When the user shares terminal output or screenshots showing a UX issue, reproduce the exact scenario locally before coding a fix — don't assume the fix from the description alone.
- [LEARN-026] Before switching git branches, run `git stash --include-untracked` if `git status` shows any changes.
- [LEARN-027] When a TUI component has been edited 5+ times in a session, stop editing.
- [LEARN-028] When the user reports a UI bug via screenshot, reproduce it locally first by running the command and confirming the exact broken state before editing code.
- [LEARN-030] After `npm audit` reveals a vulnerability, check if the vulnerable package is a direct or transitive dependency before attempting to pin it — pinning a transitive dependency in `package.json` may have no effect.
<!-- END SHEAL RULES -->

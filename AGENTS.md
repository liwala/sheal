# Agent Instructions

See also: @CLAUDE.md for Claude Code-specific instructions.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **Run quality gates** (if code changed) - Tests, linters, builds
2. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
3. **Clean up** - Clear stashes, prune remote branches
4. **Verify** - All changes committed AND pushed
5. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Git Discipline

Commit and push after every logical change. Do not accumulate uncommitted work across multiple features. Each commit should be a focused, atomic unit. Push immediately after committing.

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

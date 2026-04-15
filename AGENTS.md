# Agent Instructions

See also: @CLAUDE.md for Claude Code-specific instructions.

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

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

- Before writing parsers for external data formats (JSON APIs, JSONL transcripts, <!-- .sheal/learnings/LEARN-001-before-writing-parsers-for-external-data-formats-j.md -->
- When using an unfamiliar CLI tool for the first time, run <tool> --help and <too <!-- .sheal/learnings/LEARN-002-when-using-an-unfamiliar-cli-tool-for-the-first-ti.md -->
- After creating test fixtures, verify they match the real data format by comparin <!-- .sheal/learnings/LEARN-003-after-creating-test-fixtures-verify-they-match-the.md -->
- When a background server process (dolt, postgres, redis) is required, add it to <!-- .sheal/learnings/LEARN-004-when-a-background-server-process-dolt-postgres-red.md -->
- When bootstrapping a new TypeScript CLI project, define the full directory struc <!-- .sheal/learnings/LEARN-005-when-bootstrapping-a-new-typescript-cli-project-de.md -->
- Before parsing any external data format (Entire.io transcripts, API responses), <!-- .sheal/learnings/LEARN-006-before-parsing-any-external-data-format-entire-io-.md -->
- When `sheal check` reports warnings (like untracked files or missing services), <!-- .sheal/learnings/LEARN-007-when-sheal-check-reports-warnings-like-untracked-f.md -->
- After `npm link` or global CLI installation, always run `npx tsc && sheal --help <!-- .sheal/learnings/LEARN-008-after-npm-link-or-global-cli-installation-always-r.md -->
- When a session involves both infrastructure setup (Dolt, Entire.io hooks) and fe <!-- .sheal/learnings/LEARN-009-when-a-session-involves-both-infrastructure-setup-.md -->
- When a session hits context compaction, stop adding new features. Commit current <!-- .sheal/learnings/LEARN-010-when-a-session-hits-context-compaction-stop-adding.md -->
- Before implementing a feature that touches >3 files, write out the file-level pl <!-- .sheal/learnings/LEARN-011-before-implementing-a-feature-that-touches-3-files.md -->
- When adding support for a new agent runtime (amp, codex), read its `--help` outp <!-- .sheal/learnings/LEARN-012-when-adding-support-for-a-new-agent-runtime-amp-co.md -->
- After context compaction, re-read the 3 most-recently-edited files before resumi <!-- .sheal/learnings/LEARN-013-after-context-compaction-re-read-the-3-most-recent.md -->
- When building a TUI/browser view, get one screen working end-to-end before addin <!-- .sheal/learnings/LEARN-014-when-building-a-tui-browser-view-get-one-screen-wo.md -->
- When fixing Go compilation errors involving `syscall` or OS-specific packages, i <!-- .sheal/learnings/LEARN-015-when-fixing-go-compilation-errors-involving-syscal.md -->
- After editing a Go file, run `go build ./...` or `go vet ./...` on that specific <!-- .sheal/learnings/LEARN-016-after-editing-a-go-file-run-go-build-or-go-vet-on-.md -->
- When working inside a container or VM, run `cat /etc/os-release && which sudo do <!-- .sheal/learnings/LEARN-017-when-working-inside-a-container-or-vm-run-cat-etc-.md -->
- If a Read or Bash tool fails twice with the same error, do not retry the same ca <!-- .sheal/learnings/LEARN-018-if-a-read-or-bash-tool-fails-twice-with-the-same-e.md -->
- When a retro session's input data is incomplete (e.g., assistant responses trunc <!-- .sheal/learnings/LEARN-019-when-a-retro-session-s-input-data-is-incomplete-e-.md -->
- When running `/retro` on a prior session, verify the checkpoint data loaded comp <!-- .sheal/learnings/LEARN-020-when-running-retro-on-a-prior-session-verify-the-c.md -->
- When a session has already touched 5+ files, refuse to start a new feature witho <!-- .sheal/learnings/LEARN-022-when-a-session-has-already-touched-5-files-refuse-.md -->
- When building an interactive TUI flow with multiple states (review → edit → conf <!-- .sheal/learnings/LEARN-024-when-building-an-interactive-tui-flow-with-multipl.md -->
- When the user shares terminal output or screenshots showing a UX issue, reproduc <!-- .sheal/learnings/LEARN-025-when-the-user-shares-terminal-output-or-screenshot.md -->
- Before switching git branches, run `git stash --include-untracked` if `git statu <!-- .sheal/learnings/LEARN-026-before-switching-git-branches-run-git-stash-includ.md -->
- When a TUI component has been edited 5+ times in a session, stop editing. Write <!-- .sheal/learnings/LEARN-027-when-a-tui-component-has-been-edited-5-times-in-a-.md -->
- When the user reports a UI bug via screenshot, reproduce it locally first by run <!-- .sheal/learnings/LEARN-028-when-the-user-reports-a-ui-bug-via-screenshot-repr.md -->
- After `npm audit` reveals a vulnerability, check if the vulnerable package is a <!-- .sheal/learnings/LEARN-030-after-npm-audit-reveals-a-vulnerability-check-if-t.md -->
<!-- END SHEAL RULES -->

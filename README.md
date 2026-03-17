# Self-Healing AI Coding (`sheal`)

A CLI toolkit that analyzes AI coding sessions to extract learnings, detect failure patterns, and continuously improve agent behavior.

## Install

```bash
git clone https://github.com/luisalima/self-healing-ai-coding
cd self-healing-ai-coding
npm install
npx tsc
npm link
```

## Quick Start

```bash
# Health check your project setup
sheal check

# Run a retrospective on your latest session
sheal retro

# Ask a question across all your sessions
sheal ask "what went wrong with beads?" --agent claude

# Add a learning from experience
sheal learn add "Always inspect real data before writing parsers" --tags=parsing
```

## Commands

### `sheal check`

Pre-session health check. Detects environment issues before you start coding.

```bash
sheal check                    # Pretty output
sheal check --format json      # JSON output
sheal check --skip performance # Skip specific checkers
```

**Checkers:** git status, dependencies, tests, environment, session learnings, performance & efficiency.

The performance checker detects your AI agent (Claude Code, Cursor, Gemini, Copilot, Amp), checks for RTK token compression, MCP servers, LSP tools, and config file sizes.

### `sheal retro`

Session retrospective. Analyzes the most recent AI coding session for failure loops, wasted effort, and learnings.

```bash
sheal retro                        # Static analysis (latest session)
sheal retro --checkpoint <id>      # Specific session
sheal retro --enrich               # LLM-enriched deep analysis
sheal retro --enrich --agent amp   # Use a specific agent CLI
sheal retro --prompt               # Output raw prompt (pipe to any LLM)
sheal retro --format json          # JSON output
```

The `--enrich` flag invokes an agent CLI to perform deep analysis on top of the static retro. The agent extracts rules and offers to save them as learnings. Results are cached at `.sheal/retros/`.

### `sheal ask <question>`

Query across all your session transcripts using natural language. Uses a 3-phase pipeline:

1. **Agent generates search terms** from your question (fast, focused invocation)
2. **Local grep** across all sessions using those terms (word-boundary matching)
3. **Agent analyzes** relevant excerpts to answer your question

```bash
sheal ask "what went wrong with beads?"
sheal ask "how did we handle the auth migration?" --agent claude
sheal ask "show me all test failures" -n 20    # Search more sessions
```

Options:
- `--agent <name>` — Agent CLI to use: `claude`, `gemini`, `codex`, `amp`
- `-n, --limit <count>` — Max sessions to search (default: 10)

### `sheal sessions`

List and inspect session data from Entire.io or native Claude Code transcripts.

```bash
sheal sessions                     # List all sessions
sheal sessions --checkpoint <id>   # View session details
sheal sessions --format json       # JSON output
```

### `sheal learn`

Manage ADR-style session learnings. Learnings are stored as individual markdown files with frontmatter metadata.

```bash
# Add a learning
sheal learn add "Always check bd --help before guessing flags" \
  --tags=beads,cli --category=workflow --severity=high

# List learnings
sheal learn list              # Project learnings (.sheal/learnings/)
sheal learn list --global     # Global learnings (~/.sheal/learnings/)
sheal learn list --tag=beads  # Filter by tag

# Sync global learnings to current project (by tag match)
sheal learn sync
```

**Learning format** (`~/.sheal/learnings/LEARN-001-inspect-real-data.md`):
```markdown
---
id: LEARN-001
title: Inspect real data before writing parsers
date: 2026-03-13
tags: [parsing, external-data, general]
category: missing-context
severity: high
status: active
---

Before writing parsers for external data formats, always inspect 2-3 real
samples first. Don't rely solely on documentation or type definitions.
```

Categories: `missing-context`, `failure-loop`, `wasted-effort`, `environment`, `workflow`

## Session Sources

`sheal` supports two session data sources with automatic fallback:

1. **Entire.io** — reads from the `entire/checkpoints/v1` git branch (rich metadata, AI summaries, attribution)
2. **Native Claude Code** — reads JSONL transcripts directly from `~/.claude/projects/` (works without Entire.io)

## Supported Agents

For `--enrich` and `ask` commands, `sheal` can invoke these agent CLIs:

| Agent | CLI Command | Invocation |
|-------|-------------|------------|
| Claude Code | `claude` | `claude -p - --output-format text` (stdin) |
| Amp | `amp` | `amp --execute` (stdin) |
| Gemini CLI | `gemini` | stdin pipe |
| Codex | `codex` | `codex -q` (stdin) |
| Cursor | `claude` | Same as Claude Code |

Auto-detection tries the session's own agent first, then falls back to any available CLI.

## How It Works

```
Session Capture (Entire.io / Claude Code native)
    |  session transcripts, diffs, metadata
    v
Self-Healing Engine (sheal)
    |  failure patterns, learnings, rules
    v
Agent Configuration (CLAUDE.md, .cursorrules, etc.)
    |  improved behavior
    v
Next Session (fewer mistakes)
```

## Development

```bash
npx tsc          # Build
npx vitest run   # Test
sheal check      # Dogfood
```

## License

MIT

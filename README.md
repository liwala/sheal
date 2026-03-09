# Self-Healing AI Coding

An analysis layer that sits on top of AI coding session capture tools (like [Entire.io](https://entire.io)) to extract learnings, detect failure patterns, and continuously improve agent behavior.

## Vision

AI coding agents repeat the same mistakes across sessions. Session transcripts get captured but never analyzed. This project closes the loop:

```
Session Capture (Entire.io)
    |  session transcripts, diffs, metadata
    v
Self-Healing Engine (this project)
    |  failure patterns, learnings, rules
    v
Agent Configuration (.claude.md, .cursorrules, etc.)
    |  improved behavior
    v
Next Session (fewer mistakes)
```

## Architecture

### Core Pipeline

1. **Session Ingest** -- Read session data from Entire.io's `entire/checkpoints/v1` branch (or other sources: raw conversation logs, git diffs)
2. **Retrospective Analysis** -- Detect failure loops, wasted effort, missing context, repeated errors
3. **Learning Extraction** -- Distill sessions into structured learnings with confidence scores
4. **Rule Generation** -- Convert learnings into agent-specific config rules (CLAUDE.md, .cursorrules, etc.)
5. **Knowledge Graph** -- Accumulate learnings across sessions to detect cross-session patterns

### Key Components

- `sheal` CLI -- The main entry point. Run retrospectives, query learnings, generate rules.
- **Session Adapter** -- Pluggable adapters for different session sources (Entire.io, raw logs, Claude Code conversations)
- **Analyzers** -- Pluggable analysis modules (failure loop detection, effort estimation, context gap detection)
- **Learning Store** -- Structured storage for extracted learnings with metadata and lineage
- **Rule Emitter** -- Generate agent-specific configuration from learnings

### Data Model

```
Session
  ├── id, timestamp, agent, duration
  ├── transcript (prompts + responses)
  ├── file_changes[] (path, before, after)
  ├── errors[] (message, count, resolution)
  └── outcome (success | partial | failure)

Learning
  ├── id, source_sessions[], confidence
  ├── category (failure_pattern | context_gap | workflow | anti_pattern)
  ├── description
  ├── evidence[]
  └── suggested_rules[]

Rule
  ├── id, source_learnings[]
  ├── target_agent (claude | cursor | gemini | universal)
  ├── content (the actual rule text)
  └── effectiveness_score
```

## Roadmap

See GitHub Issues for detailed breakdown.

## Integration with Entire.io

This project is designed to complement Entire.io, not compete with it. Entire handles session capture and checkpointing. We handle analysis and learning. Together they create a complete self-healing loop.

## License

MIT

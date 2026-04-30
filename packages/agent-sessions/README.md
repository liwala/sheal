# @liwala/agent-sessions

Read AI coding agent session transcripts from disk.

Supports Claude Code, OpenAI Codex CLI, Sourcegraph Amp, Gemini CLI, and Entire.io checkpoints — exposing a normalized `SessionEntry[]` transcript along with each agent's native metadata.

## Status

`0.0.x` — extracted from [sheal](https://github.com/liwala/sheal); API may change.

## Install

```bash
npm install @liwala/agent-sessions
```

Requires Node.js ≥ 22.

## Quick example

```ts
import {
  hasNativeTranscripts,
  listNativeSessions,
  loadNativeSession,
} from "@liwala/agent-sessions";

if (hasNativeTranscripts(process.cwd())) {
  const sessions = listNativeSessions(process.cwd());
  for (const info of sessions) {
    const session = loadNativeSession(process.cwd(), info.sessionId);
    console.log(info.title, "—", session?.transcript.length, "entries");
  }
}
```

## Supported sources

| Agent / source | Reads from | Functions |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<slug>/*.jsonl` | `hasNativeTranscripts`, `listNativeSessions`, `loadNativeSession`, `listAllNativeProjects`, `listNativeSessionsBySlug`, `loadNativeSessionBySlug` |
| OpenAI Codex CLI | `~/.codex/sessions/` | `hasCodexSessions`, `listCodexProjects`, `listCodexSessionsForProject`, `loadCodexSession`, `loadCodexSessionCheckpoint` |
| Sourcegraph Amp | `~/.amp/threads/` | `hasAmpSessions`, `listAmpProjects`, `listAmpSessionsForProject`, `listAmpThreadFiles`, `getAmpThreadProjectPath` |
| Gemini CLI | `~/.gemini/` | `listGeminiProjects`, `listGeminiSessionsForProject`, `loadGeminiSession` |
| Entire.io | `entire/checkpoints/v1` git branch | `hasEntireBranch`, `listCheckpoints`, `loadCheckpoint`, `loadAllCheckpoints` |

All loaders return data shaped against shared types (`Session`, `SessionEntry`, `Checkpoint`, `CheckpointInfo`, `TokenUsage`, …) — see `src/types.ts`.

## License

MIT

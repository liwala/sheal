// Entire.io checkpoint reader
export {
  hasEntireBranch,
  listCheckpoints,
  loadCheckpoint,
  loadAllCheckpoints,
} from "./entire-reader.js";

// Claude Code native transcripts
export {
  getClaudeProjectDir,
  hasNativeTranscripts,
  listNativeSessions,
  loadNativeSession,
  listAllNativeProjects,
  listNativeSessionsBySlug,
  loadNativeSessionBySlug,
} from "./claude.js";
export type { NativeProject } from "./claude.js";

// OpenAI Codex CLI native sessions
export {
  hasCodexSessions,
  listCodexProjects,
  listCodexSessionsForProject,
  loadCodexSession,
  loadCodexSessionCheckpoint,
  codexSessionToCheckpoint,
} from "./codex.js";
export type {
  CodexProject,
  CodexSessionFile,
  CodexTranscriptEntry,
} from "./codex.js";

// Sourcegraph Amp native sessions
export {
  hasAmpSessions,
  listAmpProjects,
  listAmpSessionsForProject,
  getAmpThreadProjectPath,
  listAmpThreadFiles,
} from "./amp.js";
export type { AmpFileChange, AmpThread } from "./amp.js";

// Gemini CLI native sessions
export {
  hasGeminiSessions,
  listGeminiProjects,
  listGeminiSessionsForProject,
  loadGeminiSession,
} from "./gemini.js";
export type {
  GeminiProject,
  GeminiSessionFile,
  GeminiTranscriptEntry,
} from "./gemini.js";

// Transcript normalization
export { parseTranscript } from "./transcript.js";

// Shared types
export type {
  AgentType,
  Checkpoint,
  CheckpointInfo,
  CheckpointRoot,
  CheckpointSummary,
  CodeLearning,
  EntryType,
  InitialAttribution,
  Session,
  SessionEntry,
  SessionMetadata,
  SessionMetrics,
  TokenUsage,
} from "./types.js";

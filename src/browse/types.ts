import type { Checkpoint, CheckpointInfo, NativeProject } from "@liwala/agent-sessions";

export type View = "projects" | "project-overview" | "sessions" | "timeline" | "detail" | "search-results" | "retro-list" | "retro-detail" | "learnings" | "asks-list" | "ask-detail" | "digests-list" | "digest-detail";

export interface BrowseState {
  view: View;
  selectedProject: NativeProject | null;
  selectedSessionId: string | null;
  searchQuery: string;
  agentFilter: string | null;
  showAll: boolean;
}

export interface SearchResult {
  slug: string;
  sessionId: string;
  projectName: string;
  title?: string;
  createdAt: string;
  matchCount: number;
  snippet: string;
}

import type { NativeProject } from "../entire/claude-native.js";
import type { CheckpointInfo, Checkpoint } from "../entire/types.js";

export type View = "projects" | "sessions" | "detail" | "search-results";

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

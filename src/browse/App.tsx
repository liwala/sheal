import { useState, useCallback } from "react";
import { useApp } from "ink";
import type { NativeProject } from "../entire/claude-native.js";
import type { CheckpointInfo } from "../entire/types.js";
import type { View } from "./types.js";
import { ProjectList } from "./views/ProjectList.js";
import { SessionList } from "./views/SessionList.js";
import { SessionDetail } from "./views/SessionDetail.js";
import { SearchResults } from "./views/SearchResults.js";

const AGENTS = [null, "claude", "codex", "amp", "gemini"];

interface AppProps {
  initialProject?: string;
  initialQuery?: string;
  initialAgent?: string;
}

export function App({ initialProject, initialQuery, initialAgent }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(initialQuery ? "search-results" : "projects");
  const [selectedProject, setSelectedProject] = useState<NativeProject | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string | null>(initialAgent || null);
  const [searchQuery, setSearchQuery] = useState(initialQuery || "");

  const handleQuit = useCallback(() => exit(), [exit]);

  const handleAgentToggle = useCallback(() => {
    setAgentFilter((current) => {
      const idx = AGENTS.indexOf(current);
      return AGENTS[(idx + 1) % AGENTS.length];
    });
  }, []);

  const handleSelectProject = useCallback((project: NativeProject) => {
    setSelectedProject(project);
    setView("sessions");
  }, []);

  const handleSelectSession = useCallback((session: CheckpointInfo) => {
    if (selectedProject) {
      setSelectedSlug(selectedProject.slug);
    }
    setSelectedSessionId(session.sessionId);
    setView("detail");
  }, [selectedProject]);

  const handleSelectSearchResult = useCallback((slug: string, sessionId: string) => {
    setSelectedSlug(slug);
    setSelectedSessionId(sessionId);
    setView("detail");
  }, []);

  const handleSearch = useCallback(() => {
    setView("search-results");
  }, []);

  const handleBack = useCallback(() => {
    if (view === "detail") {
      // Go back to wherever we came from
      if (selectedProject) {
        setView("sessions");
      } else {
        setView("search-results");
      }
    } else if (view === "sessions") {
      setView("projects");
      setSelectedProject(null);
    } else if (view === "search-results") {
      setView("projects");
    }
  }, [view, selectedProject]);

  switch (view) {
    case "projects":
      return (
        <ProjectList
          onSelect={handleSelectProject}
          onSearch={handleSearch}
          onQuit={handleQuit}
          agentFilter={agentFilter}
          onAgentFilterToggle={handleAgentToggle}
          initialFilter={initialProject}
        />
      );

    case "sessions":
      if (!selectedProject) return null;
      return (
        <SessionList
          project={selectedProject}
          onSelect={handleSelectSession}
          onBack={handleBack}
          onSearch={handleSearch}
          onQuit={handleQuit}
          agentFilter={agentFilter}
          onAgentFilterToggle={handleAgentToggle}
        />
      );

    case "detail":
      return (
        <SessionDetail
          slug={selectedSlug}
          sessionId={selectedSessionId}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );

    case "search-results":
      return (
        <SearchResults
          initialQuery={searchQuery}
          onSelectSession={handleSelectSearchResult}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );
  }
}

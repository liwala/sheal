import { useState, useCallback } from "react";
import { useApp } from "ink";
import type { NativeProject } from "../entire/claude-native.js";
import type { CheckpointInfo } from "../entire/types.js";
import type { View } from "./types.js";
import { ProjectList } from "./views/ProjectList.js";
import { SessionList } from "./views/SessionList.js";
import { SessionDetail } from "./views/SessionDetail.js";
import { SearchResults } from "./views/SearchResults.js";
import { RetroList } from "./views/RetroList.js";
import { RetroDetail } from "./views/RetroDetail.js";
import { LearningsList } from "./views/LearningsList.js";

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
  // Track where retro-detail was entered from
  const [retroFrom, setRetroFrom] = useState<"session" | "retro-list">("retro-list");

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

  const handleViewRetros = useCallback(() => {
    setView("retro-list");
  }, []);

  const handleViewLearnings = useCallback(() => {
    setView("learnings");
  }, []);

  const handleSelectRetro = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setRetroFrom("retro-list");
    setView("retro-detail");
  }, []);

  const handleViewRetroFromSession = useCallback(() => {
    setRetroFrom("session");
    setView("retro-detail");
  }, []);

  const handleBack = useCallback(() => {
    if (view === "detail") {
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
    } else if (view === "retro-list") {
      setView("sessions");
    } else if (view === "retro-detail") {
      setView(retroFrom === "session" ? "detail" : "retro-list");
    } else if (view === "learnings") {
      setView("sessions");
    }
  }, [view, selectedProject, retroFrom]);

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
          onViewRetros={handleViewRetros}
          onViewLearnings={handleViewLearnings}
        />
      );

    case "detail":
      return (
        <SessionDetail
          slug={selectedSlug}
          sessionId={selectedSessionId}
          projectPath={selectedProject?.projectPath || ""}
          onBack={handleBack}
          onQuit={handleQuit}
          onViewRetro={handleViewRetroFromSession}
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

    case "retro-list":
      if (!selectedProject) return null;
      return (
        <RetroList
          projectPath={selectedProject.projectPath}
          projectName={selectedProject.name}
          onSelect={handleSelectRetro}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );

    case "retro-detail":
      return (
        <RetroDetail
          projectPath={selectedProject?.projectPath || ""}
          sessionId={selectedSessionId}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );

    case "learnings":
      if (!selectedProject) return null;
      return (
        <LearningsList
          projectPath={selectedProject.projectPath}
          projectName={selectedProject.name}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );
  }
}

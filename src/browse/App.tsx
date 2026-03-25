import { useState, useCallback, useRef } from "react";
import { useApp } from "ink";
import type { NativeProject } from "../entire/claude-native.js";
import type { CheckpointInfo } from "../entire/types.js";
import type { View } from "./types.js";
import { ProjectList } from "./views/ProjectList.js";
import { ProjectOverview } from "./views/ProjectOverview.js";
import { SessionList } from "./views/SessionList.js";
import { SessionDetail } from "./views/SessionDetail.js";
import { AmpSessionDetail } from "./views/AmpSessionDetail.js";
import { CodexSessionDetail } from "./views/CodexSessionDetail.js";
import { EntireSessionDetail } from "./views/EntireSessionDetail.js";
import { SearchResults } from "./views/SearchResults.js";
import { RetroList } from "./views/RetroList.js";
import { RetroDetail } from "./views/RetroDetail.js";
import { LearningsList } from "./views/LearningsList.js";
import { AsksList } from "./views/AsksList.js";
import { AskDetail } from "./views/AskDetail.js";

const AGENTS = [null, "claude", "codex", "amp", "gemini"];

interface AppProps {
  initialProject?: string;
  initialQuery?: string;
  initialAgent?: string;
  initialView?: View;
}

export function App({ initialProject, initialQuery, initialAgent, initialView }: AppProps) {
  const { exit } = useApp();
  const needsProject = initialView && ["retro-list", "learnings", "sessions", "asks-list"].includes(initialView);
  const [view, setView] = useState<View>(
    needsProject ? "projects" : (initialView || (initialQuery ? "search-results" : "projects")),
  );
  const [selectedProject, setSelectedProject] = useState<NativeProject | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedAskFile, setSelectedAskFile] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string | null>(initialAgent || null);
  const [searchQuery, setSearchQuery] = useState(initialQuery || "");
  const [retroFrom, setRetroFrom] = useState<"session" | "retro-list">("retro-list");
  const pendingViewRef = useRef<View | null>(
    initialView && ["retro-list", "learnings", "asks-list"].includes(initialView) ? initialView : null,
  );

  const handleQuit = useCallback(() => exit(), [exit]);

  const handleAgentToggle = useCallback(() => {
    setAgentFilter((current) => {
      const idx = AGENTS.indexOf(current);
      return AGENTS[(idx + 1) % AGENTS.length];
    });
  }, []);

  const handleSelectProject = useCallback((project: NativeProject) => {
    setSelectedProject(project);
    if (pendingViewRef.current) {
      setView(pendingViewRef.current);
      pendingViewRef.current = null;
    } else {
      setView("project-overview");
    }
  }, []);

  const handleSelectSession = useCallback((session: CheckpointInfo) => {
    if (selectedProject?.agents) {
      const agentKey = session.agent === "Claude Code" ? "claude"
        : session.agent === "Codex" ? "codex"
        : session.agent === "Amp" ? "amp"
        : "claude";
      const match = selectedProject.agents.find((a) => a.agent === agentKey);
      setSelectedSlug(match?.slug || selectedProject.slug);
    } else if (selectedProject) {
      setSelectedSlug(selectedProject.slug);
    }
    setSelectedSessionId(session.sessionId);
    setSelectedAgent(session.agent || "");
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

  const handleViewSessions = useCallback(() => { setView("sessions"); }, []);
  const handleViewRetros = useCallback(() => { setView("retro-list"); }, []);
  const handleViewLearnings = useCallback(() => { setView("learnings"); }, []);
  const handleViewAsks = useCallback(() => { setView("asks-list"); }, []);

  const handleSelectRetro = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setRetroFrom("retro-list");
    setView("retro-detail");
  }, []);

  const handleSelectAsk = useCallback((filename: string) => {
    setSelectedAskFile(filename);
    setView("ask-detail");
  }, []);

  const handleViewRetroFromSession = useCallback(() => {
    setRetroFrom("session");
    setView("retro-detail");
  }, []);

  const handleBack = useCallback(() => {
    if (view === "detail") {
      setView(selectedProject ? "sessions" : "search-results");
    } else if (view === "sessions" || view === "retro-list" || view === "learnings" || view === "asks-list") {
      setView("project-overview");
    } else if (view === "project-overview") {
      setView("projects");
      setSelectedProject(null);
    } else if (view === "search-results") {
      setView("projects");
    } else if (view === "retro-detail") {
      setView(retroFrom === "session" ? "detail" : "retro-list");
    } else if (view === "ask-detail") {
      setView("asks-list");
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

    case "project-overview":
      if (!selectedProject) return null;
      return (
        <ProjectOverview
          project={selectedProject}
          onViewSessions={handleViewSessions}
          onViewRetros={handleViewRetros}
          onViewLearnings={handleViewLearnings}
          onViewAsks={handleViewAsks}
          onBack={handleBack}
          onQuit={handleQuit}
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
      if (selectedSessionId.startsWith("T-")) {
        return (
          <AmpSessionDetail
            threadId={selectedSessionId}
            projectPath={selectedProject?.projectPath || ""}
            onBack={handleBack}
            onQuit={handleQuit}
          />
        );
      }
      if (selectedAgent === "Codex") {
        return (
          <CodexSessionDetail
            sessionId={selectedSessionId}
            projectPath={selectedProject?.projectPath || ""}
            onBack={handleBack}
            onQuit={handleQuit}
            onViewRetro={handleViewRetroFromSession}
          />
        );
      }
      if (selectedAgent === "Entire.io") {
        return (
          <EntireSessionDetail
            checkpointId={selectedSessionId}
            projectPath={selectedProject?.projectPath || ""}
            onBack={handleBack}
            onQuit={handleQuit}
            onViewRetro={handleViewRetroFromSession}
          />
        );
      }
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

    case "asks-list":
      if (!selectedProject) return null;
      return (
        <AsksList
          projectPath={selectedProject.projectPath}
          projectName={selectedProject.name}
          onSelect={handleSelectAsk}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );

    case "ask-detail":
      return (
        <AskDetail
          projectPath={selectedProject?.projectPath || ""}
          filename={selectedAskFile}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      );
  }
}

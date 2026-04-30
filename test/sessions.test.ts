import { describe, it, expect, vi, beforeEach } from "vitest";
import { runExport } from "../src/commands/export.js";

// Mock dependencies
vi.mock("@liwala/agent-sessions", () => ({
  hasEntireBranch: vi.fn().mockResolvedValue(false),
  listCheckpoints: vi.fn().mockResolvedValue([]),
  loadCheckpoint: vi.fn().mockResolvedValue(null),
  hasNativeTranscripts: vi.fn().mockReturnValue(false),
  listNativeSessions: vi.fn().mockReturnValue([]),
  loadNativeSession: vi.fn().mockReturnValue(null),
  listAllNativeProjects: vi.fn().mockReturnValue([]),
  listNativeSessionsBySlug: vi.fn().mockReturnValue([]),
}));

import {
  hasEntireBranch,
  hasNativeTranscripts,
  listNativeSessions,
  listAllNativeProjects,
  listNativeSessionsBySlug,
} from "@liwala/agent-sessions";

describe("runExport", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    // Reset defaults
    vi.mocked(hasEntireBranch).mockResolvedValue(false);
    vi.mocked(hasNativeTranscripts).mockReturnValue(false);
    vi.mocked(listNativeSessions).mockReturnValue([]);
    vi.mocked(listAllNativeProjects).mockReturnValue([]);
    vi.mocked(listNativeSessionsBySlug).mockReturnValue([]);
  });

  it("outputs JSON error object when no data found", async () => {
    await runExport({ projectRoot: "/tmp/fake" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toEqual({ error: "No session data found" });
  });

  it("outputs JSON error in global mode with no projects", async () => {
    await runExport({ projectRoot: "/tmp/fake", global: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toEqual({ error: "No Claude Code projects found" });
  });

  it("outputs native sessions as JSON", async () => {
    vi.mocked(hasNativeTranscripts).mockReturnValue(true);
    const mockSessions = [
      {
        checkpointId: "abc123def456",
        createdAt: "2026-03-20T10:00:00Z",
        strategy: "native",
        branch: "main",
        filesTouched: ["src/index.ts"],
        agent: "claude",
        title: "Test session",
      },
    ];
    vi.mocked(listNativeSessions).mockReturnValue(mockSessions as any);

    await runExport({ projectRoot: "/tmp/fake" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.source).toBe("claude-native");
    expect(parsed.checkpoints).toHaveLength(1);
    expect(parsed.checkpoints[0].checkpointId).toBe("abc123def456");
  });

  it("lists global projects with sessions as JSON", async () => {
    const mockProjects = [
      {
        slug: "test-project",
        name: "test-project",
        projectPath: "/home/user/test-project",
        sessionCount: 2,
        lastModified: "2026-03-20T10:00:00Z",
      },
    ];
    vi.mocked(listAllNativeProjects).mockReturnValue(mockProjects as any);
    vi.mocked(listNativeSessionsBySlug).mockReturnValue([
      {
        sessionId: "sess-001",
        createdAt: "2026-03-20T10:00:00Z",
        title: "First session",
      },
      {
        sessionId: "sess-002",
        createdAt: "2026-03-20T11:00:00Z",
        title: "Second session",
      },
    ] as any);

    await runExport({ projectRoot: "/tmp/fake", global: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.source).toBe("claude-native-global");
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].slug).toBe("test-project");
    expect(parsed.projects[0].sessions).toHaveLength(2);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to mock homedir to point to our temp directory
const testHome = join(tmpdir(), `sheal-amp-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testHome };
});

// Import after mock setup
const {
  hasAmpSessions,
  listAmpProjects,
  listAmpSessionsForProject,
  listAmpThreadFiles,
} = await import("@liwala/agent-sessions");

function makeFileChange(opts: {
  id: string;
  uri: string;
  isNewFile?: boolean;
  reverted?: boolean;
  timestamp: number;
  diff?: string;
}) {
  return JSON.stringify({
    id: opts.id,
    uri: opts.uri,
    before: "old content",
    after: "new content",
    diff: opts.diff || "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new",
    isNewFile: opts.isNewFile ?? false,
    reverted: opts.reverted ?? false,
    timestamp: opts.timestamp,
  });
}

describe("amp-native", () => {
  beforeEach(() => {
    // Clean up any previous test data
    try { rmSync(testHome, { recursive: true }); } catch { /* ignore */ }
  });

  afterEach(() => {
    try { rmSync(testHome, { recursive: true }); } catch { /* ignore */ }
  });

  describe("hasAmpSessions", () => {
    it("returns false when ~/.amp/file-changes does not exist", () => {
      expect(hasAmpSessions()).toBe(false);
    });

    it("returns true when ~/.amp/file-changes exists", () => {
      mkdirSync(join(testHome, ".amp", "file-changes"), { recursive: true });
      expect(hasAmpSessions()).toBe(true);
    });
  });

  describe("listAmpThreadFiles", () => {
    it("returns file changes for a thread", () => {
      const threadDir = join(testHome, ".amp", "file-changes", "T-abc123");
      mkdirSync(threadDir, { recursive: true });

      writeFileSync(join(threadDir, "change1.json"), makeFileChange({
        id: "id-1",
        uri: "file:///Users/lu/code/proj/src/main.ts",
        timestamp: 1773214562000,
      }));
      writeFileSync(join(threadDir, "change2.json"), makeFileChange({
        id: "id-2",
        uri: "file:///Users/lu/code/proj/src/util.ts",
        timestamp: 1773214563000,
        isNewFile: true,
      }));

      const files = listAmpThreadFiles("T-abc123");
      expect(files).toHaveLength(2);
      expect(files[0].filePath).toBe("/Users/lu/code/proj/src/main.ts");
      expect(files[0].id).toBe("id-1");
      expect(files[1].isNewFile).toBe(true);
      // Should be sorted by timestamp ascending
      expect(files[0].timestamp).toBeLessThan(files[1].timestamp);
    });

    it("returns empty array for non-existent thread", () => {
      mkdirSync(join(testHome, ".amp", "file-changes"), { recursive: true });
      expect(listAmpThreadFiles("T-nonexistent")).toEqual([]);
    });
  });

  describe("project path inference", () => {
    it("infers project path from common URI prefix", () => {
      const threadDir = join(testHome, ".amp", "file-changes", "T-proj1");
      mkdirSync(threadDir, { recursive: true });

      writeFileSync(join(threadDir, "c1.json"), makeFileChange({
        id: "1",
        uri: "file:///Users/lu/code/myproject/src/main.ts",
        timestamp: 1000,
      }));
      writeFileSync(join(threadDir, "c2.json"), makeFileChange({
        id: "2",
        uri: "file:///Users/lu/code/myproject/src/utils/helper.ts",
        timestamp: 2000,
      }));
      writeFileSync(join(threadDir, "c3.json"), makeFileChange({
        id: "3",
        uri: "file:///Users/lu/code/myproject/package.json",
        timestamp: 3000,
      }));

      const projects = listAmpProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].projectPath).toBe("/Users/lu/code/myproject");
      expect(projects[0].name).toBe("myproject");
    });

    it("groups threads by inferred project path", () => {
      const ampDir = join(testHome, ".amp", "file-changes");

      // Thread 1: project A
      const t1Dir = join(ampDir, "T-thread1");
      mkdirSync(t1Dir, { recursive: true });
      writeFileSync(join(t1Dir, "c1.json"), makeFileChange({
        id: "1",
        uri: "file:///Users/lu/code/projA/src/file1.ts",
        timestamp: 1000,
      }));

      // Thread 2: project A (same project)
      const t2Dir = join(ampDir, "T-thread2");
      mkdirSync(t2Dir, { recursive: true });
      writeFileSync(join(t2Dir, "c1.json"), makeFileChange({
        id: "2",
        uri: "file:///Users/lu/code/projA/src/file2.ts",
        timestamp: 2000,
      }));

      // Thread 3: project B (different project)
      const t3Dir = join(ampDir, "T-thread3");
      mkdirSync(t3Dir, { recursive: true });
      writeFileSync(join(t3Dir, "c1.json"), makeFileChange({
        id: "3",
        uri: "file:///Users/lu/code/projB/main.py",
        timestamp: 3000,
      }));

      const projects = listAmpProjects();
      expect(projects).toHaveLength(2);

      const slugs = projects.map((p) => p.slug).sort();
      expect(slugs).toContain("amp:/Users/lu/code/projA/src");
      expect(slugs).toContain("amp:/Users/lu/code/projB");
    });
  });

  describe("NativeProject shape", () => {
    it("returns objects with required NativeProject fields", () => {
      const threadDir = join(testHome, ".amp", "file-changes", "T-shape");
      mkdirSync(threadDir, { recursive: true });

      writeFileSync(join(threadDir, "c1.json"), makeFileChange({
        id: "1",
        uri: "file:///Users/lu/code/test/file.ts",
        timestamp: 1773214562000,
      }));

      const projects = listAmpProjects();
      expect(projects).toHaveLength(1);

      const p = projects[0];
      expect(p).toHaveProperty("slug");
      expect(p).toHaveProperty("projectPath");
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("sessionCount");
      expect(p).toHaveProperty("lastModified");
      expect(p.slug).toMatch(/^amp:/);
      expect(typeof p.sessionCount).toBe("number");
      expect(p.lastModified).toMatch(/^\d{4}-/); // ISO date string
    });
  });

  describe("listAmpSessionsForProject", () => {
    it("returns CheckpointInfo[] for matching threads", () => {
      const ampDir = join(testHome, ".amp", "file-changes");
      const t1Dir = join(ampDir, "T-sess1");
      mkdirSync(t1Dir, { recursive: true });

      writeFileSync(join(t1Dir, "c1.json"), makeFileChange({
        id: "1",
        uri: "file:///Users/lu/code/proj/src/a.ts",
        timestamp: 1773214560000,
      }));
      writeFileSync(join(t1Dir, "c2.json"), makeFileChange({
        id: "2",
        uri: "file:///Users/lu/code/proj/src/b.ts",
        timestamp: 1773214562000,
        reverted: true,
      }));

      const sessions = listAmpSessionsForProject("/Users/lu/code/proj/src");
      expect(sessions).toHaveLength(1);

      const s = sessions[0];
      expect(s.sessionId).toBe("T-sess1");
      expect(s.agent).toBe("Amp");
      expect(s.title).toContain("Modified 2 files");
      expect(s.title).toContain("1 reverted");
      expect(s.filesTouched).toHaveLength(2);
      expect(s.createdAt).toMatch(/^\d{4}-/);
    });

    it("uses filename as title for single-file threads", () => {
      const threadDir = join(testHome, ".amp", "file-changes", "T-single");
      mkdirSync(threadDir, { recursive: true });

      writeFileSync(join(threadDir, "c1.json"), makeFileChange({
        id: "1",
        uri: "file:///Users/lu/code/proj/config.json",
        timestamp: 1000,
      }));

      const sessions = listAmpSessionsForProject("/Users/lu/code/proj");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe("config.json");
    });
  });
});

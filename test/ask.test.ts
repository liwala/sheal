import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  nextId,
  slugify,
  writeLearning,
  readLearning,
  parseLearningContent,
  listLearnings,
} from "../src/learn/store.js";
import type { LearningFile } from "../src/learn/types.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sheal-ask-test-"));
}

function makeLearning(overrides: Partial<LearningFile> = {}): LearningFile {
  return {
    id: "LEARN-001",
    title: "Test learning",
    date: "2026-03-23",
    tags: ["test", "vitest"],
    category: "workflow",
    severity: "medium",
    status: "active",
    body: "This is the body of the learning.",
    ...overrides,
  };
}

describe("nextId", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns LEARN-001 for a non-existent directory", () => {
    expect(nextId("/no/such/dir/ever")).toBe("LEARN-001");
  });

  it("returns LEARN-001 for an empty directory", () => {
    tmpDir = makeTmpDir();
    expect(nextId(tmpDir)).toBe("LEARN-001");
  });

  it("returns LEARN-002 when LEARN-001 exists", () => {
    tmpDir = makeTmpDir();
    writeFileSync(join(tmpDir, "LEARN-001-something.md"), "x");
    expect(nextId(tmpDir)).toBe("LEARN-002");
  });

  it("handles gaps by returning max+1", () => {
    tmpDir = makeTmpDir();
    writeFileSync(join(tmpDir, "LEARN-001-a.md"), "x");
    writeFileSync(join(tmpDir, "LEARN-003-b.md"), "x");
    // Gap at 002 — should still return 004 (max + 1)
    expect(nextId(tmpDir)).toBe("LEARN-004");
  });

  it("ignores non-LEARN files", () => {
    tmpDir = makeTmpDir();
    writeFileSync(join(tmpDir, "README.md"), "x");
    writeFileSync(join(tmpDir, "LEARN-005-foo.md"), "x");
    expect(nextId(tmpDir)).toBe("LEARN-006");
  });

  it("pads IDs to 3 digits", () => {
    tmpDir = makeTmpDir();
    writeFileSync(join(tmpDir, "LEARN-009-foo.md"), "x");
    expect(nextId(tmpDir)).toBe("LEARN-010");
  });

  it("handles large IDs beyond 3 digits", () => {
    tmpDir = makeTmpDir();
    writeFileSync(join(tmpDir, "LEARN-999-foo.md"), "x");
    expect(nextId(tmpDir)).toBe("LEARN-1000");
  });
});

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Don't use tabs!")).toBe("don-t-use-tabs");
  });

  it("collapses consecutive separators", () => {
    expect(slugify("a --- b")).toBe("a-b");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("---leading---")).toBe("leading");
  });

  it("truncates to 50 characters", () => {
    const long = "a".repeat(80);
    expect(slugify(long).length).toBe(50);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles unicode by stripping non-ascii", () => {
    expect(slugify("café résumé")).toBe("caf-r-sum");
  });
});

describe("writeLearning", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates a file with correct frontmatter and body", () => {
    tmpDir = makeTmpDir();
    const learning = makeLearning();
    const filepath = writeLearning(tmpDir, learning);

    expect(existsSync(filepath)).toBe(true);
    expect(filepath).toContain("LEARN-001-test-learning.md");

    const result = readLearning(filepath);
    expect(result.id).toBe("LEARN-001");
    expect(result.title).toBe("Test learning");
    expect(result.date).toBe("2026-03-23");
    expect(result.tags).toEqual(["test", "vitest"]);
    expect(result.category).toBe("workflow");
    expect(result.severity).toBe("medium");
    expect(result.status).toBe("active");
    expect(result.body).toBe("This is the body of the learning.");
  });

  it("creates the directory if it does not exist", () => {
    tmpDir = makeTmpDir();
    const nested = join(tmpDir, "sub", "dir");
    const learning = makeLearning();
    const filepath = writeLearning(nested, learning);

    expect(existsSync(filepath)).toBe(true);
  });

  it("includes sessionId when present", () => {
    tmpDir = makeTmpDir();
    const learning = makeLearning({ sessionId: "abc-123" });
    const filepath = writeLearning(tmpDir, learning);

    const result = readLearning(filepath);
    expect(result.sessionId).toBe("abc-123");
  });

  it("bumps ID on EEXIST collision", () => {
    tmpDir = makeTmpDir();
    const learning1 = makeLearning({ id: "LEARN-001" });
    const path1 = writeLearning(tmpDir, learning1);
    expect(path1).toContain("LEARN-001");

    // Write another learning with the same ID — should bump to LEARN-002
    const learning2 = makeLearning({ id: "LEARN-001", body: "Second learning" });
    const path2 = writeLearning(tmpDir, learning2);
    expect(path2).toContain("LEARN-002");
    expect(path2).not.toBe(path1);

    // Verify both files exist
    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(2);
  });

  it("mutates the learning.id on collision", () => {
    tmpDir = makeTmpDir();
    writeLearning(tmpDir, makeLearning({ id: "LEARN-001" }));

    const learning2 = makeLearning({ id: "LEARN-001" });
    writeLearning(tmpDir, learning2);
    // The learning object should have been mutated to the bumped ID
    expect(learning2.id).toBe("LEARN-002");
  });
});

describe("parseLearningContent", () => {
  it("parses a well-formed learning file", () => {
    const content = `---
id: LEARN-042
title: Always rebuild before testing
date: 2026-01-15
tags: [build, typescript]
category: environment
severity: high
status: active
---

Rebuild with \`npx tsc\` before running any sheal commands.
`;

    const result = parseLearningContent(content);
    expect(result.id).toBe("LEARN-042");
    expect(result.title).toBe("Always rebuild before testing");
    expect(result.date).toBe("2026-01-15");
    expect(result.tags).toEqual(["build", "typescript"]);
    expect(result.category).toBe("environment");
    expect(result.severity).toBe("high");
    expect(result.status).toBe("active");
    expect(result.body).toBe(
      "Rebuild with `npx tsc` before running any sheal commands."
    );
  });

  it("handles empty tags", () => {
    const content = `---
id: LEARN-001
title: Test
date: 2026-01-01
tags: []
category: workflow
severity: low
status: active
---

Body.
`;
    const result = parseLearningContent(content);
    expect(result.tags).toEqual([]);
  });

  it("handles session-id field", () => {
    const content = `---
id: LEARN-001
title: Test
date: 2026-01-01
tags: [a]
category: workflow
severity: medium
status: active
session-id: sess-xyz-789
---

Body text.
`;
    const result = parseLearningContent(content);
    expect(result.sessionId).toBe("sess-xyz-789");
  });

  it("throws on content without frontmatter delimiters", () => {
    expect(() => parseLearningContent("no frontmatter here")).toThrow(
      "missing frontmatter delimiters"
    );
  });

  it("preserves body containing --- separators", () => {
    const content = `---
id: LEARN-001
title: Test
date: 2026-01-01
tags: []
category: workflow
severity: low
status: active
---

First section.

---

Second section after horizontal rule.
`;
    const result = parseLearningContent(content);
    expect(result.body).toContain("First section.");
    expect(result.body).toContain("---");
    expect(result.body).toContain("Second section after horizontal rule.");
  });

  it("round-trips through writeLearning and readLearning", () => {
    const tmpDir = makeTmpDir();
    try {
      const original = makeLearning({
        id: "LEARN-007",
        title: "Round trip test",
        tags: ["alpha", "beta", "gamma"],
        category: "failure-loop",
        severity: "high",
        status: "active",
        sessionId: "session-roundtrip",
        body: "Make sure everything survives the round trip.",
      });

      const filepath = writeLearning(tmpDir, original);
      const parsed = readLearning(filepath);

      expect(parsed.id).toBe(original.id);
      expect(parsed.title).toBe(original.title);
      expect(parsed.date).toBe(original.date);
      expect(parsed.tags).toEqual(original.tags);
      expect(parsed.category).toBe(original.category);
      expect(parsed.severity).toBe(original.severity);
      expect(parsed.status).toBe(original.status);
      expect(parsed.body).toBe(original.body);
      expect(parsed.sessionId).toBe(original.sessionId);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("listLearnings", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns empty array for non-existent directory", () => {
    expect(listLearnings("/no/such/dir")).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    tmpDir = makeTmpDir();
    expect(listLearnings(tmpDir)).toEqual([]);
  });

  it("returns learnings sorted by filename", () => {
    tmpDir = makeTmpDir();

    // Write in reverse order to verify sorting
    writeLearning(tmpDir, makeLearning({ id: "LEARN-003", title: "Third" }));
    writeLearning(tmpDir, makeLearning({ id: "LEARN-001", title: "First" }));
    writeLearning(tmpDir, makeLearning({ id: "LEARN-002", title: "Second" }));

    const results = listLearnings(tmpDir);
    expect(results.length).toBe(3);
    expect(results[0].id).toBe("LEARN-001");
    expect(results[1].id).toBe("LEARN-002");
    expect(results[2].id).toBe("LEARN-003");
  });

  it("ignores non-LEARN files", () => {
    tmpDir = makeTmpDir();
    writeLearning(tmpDir, makeLearning({ id: "LEARN-001", title: "Real" }));
    writeFileSync(join(tmpDir, "README.md"), "not a learning");
    writeFileSync(join(tmpDir, "notes.txt"), "also not");

    const results = listLearnings(tmpDir);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("LEARN-001");
  });

  it("ignores LEARN- files without .md extension", () => {
    tmpDir = makeTmpDir();
    writeLearning(tmpDir, makeLearning({ id: "LEARN-001", title: "Valid" }));
    writeFileSync(join(tmpDir, "LEARN-002-no-ext"), "no .md extension");

    const results = listLearnings(tmpDir);
    expect(results.length).toBe(1);
  });
});

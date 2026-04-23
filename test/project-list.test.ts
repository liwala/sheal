import { describe, it, expect } from "vitest";
import { filterProjectsForContent } from "../src/browse/views/ProjectList.js";

describe("filterProjectsForContent", () => {
  it("keeps only projects with retros in retro browse mode", () => {
    const projects = [
      {
        slug: "with-retros",
        name: "with-retros",
        projectPath: "/tmp/with-retros",
        sessionCount: 3,
        lastModified: "2026-04-23T10:00:00Z",
      },
      {
        slug: "without-retros",
        name: "without-retros",
        projectPath: "/tmp/without-retros",
        sessionCount: 4,
        lastModified: "2026-04-23T09:00:00Z",
      },
    ];

    const stats = new Map([
      ["/tmp/with-retros", { retros: 2, learnings: 0, asks: 0 }],
      ["/tmp/without-retros", { retros: 0, learnings: 3, asks: 1 }],
    ]);

    expect(filterProjectsForContent(projects as any, "retros", stats)).toEqual([projects[0]]);
  });

  it("returns all projects outside retro browse mode", () => {
    const projects = [
      {
        slug: "alpha",
        name: "alpha",
        projectPath: "/tmp/alpha",
        sessionCount: 1,
        lastModified: "2026-04-23T10:00:00Z",
      },
      {
        slug: "beta",
        name: "beta",
        projectPath: "/tmp/beta",
        sessionCount: 1,
        lastModified: "2026-04-23T09:00:00Z",
      },
    ];

    const stats = new Map<string, { retros: number; learnings: number; asks: number }>();

    expect(filterProjectsForContent(projects as any, "all", stats)).toEqual(projects);
  });
});

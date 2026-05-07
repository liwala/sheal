import { describe, it, expect } from "vitest";
import { getPendingProjectView } from "../src/browse/App.js";
import { moveSearchCursor } from "../src/browse/views/SearchResults.js";

describe("browse initial view routing", () => {
  it("keeps sessions as a pending project-scoped view", () => {
    expect(getPendingProjectView("sessions")).toBe("sessions");
  });

  it("does not require a project for global digest view", () => {
    expect(getPendingProjectView("digests-list")).toBeNull();
  });
});

describe("search result navigation", () => {
  it("scrolls when the cursor moves beyond the visible window", () => {
    const state = moveSearchCursor(4, 0, 1, 10, 5);
    expect(state).toEqual({ cursor: 5, scrollOffset: 1 });
  });

  it("scrolls back up when moving above the visible window", () => {
    const state = moveSearchCursor(3, 4, -1, 10, 5);
    expect(state).toEqual({ cursor: 2, scrollOffset: 2 });
  });
});

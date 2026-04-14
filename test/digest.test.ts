import { describe, it, expect } from "vitest";
import { parseSince } from "../src/digest/loader.js";
import { categorizePrompts } from "../src/digest/categorize.js";
import { estimateCost, diffDigests, getPricing } from "../src/digest/cost.js";
import type { RawPrompt, TokenSummary, DigestReport } from "../src/digest/types.js";

// ── parseSince ──────────────────────────────────────────────────────

describe("parseSince", () => {
  it("parses '7 days' as ~7 days ago", () => {
    const result = parseSince("7 days");
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    // Allow 1 second tolerance
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("parses '1 week'", () => {
    const result = parseSince("1 week");
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("parses '2 months'", () => {
    const result = parseSince("2 months");
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 2);
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("parses ISO date string", () => {
    const result = parseSince("2026-01-15");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(15);
  });

  it("defaults to 7 days for unrecognized input", () => {
    const result = parseSince("garbage");
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });
});

// ── categorizePrompts ───────────────────────────────────────────────

function makePrompt(text: string, overrides?: Partial<RawPrompt>): RawPrompt {
  return {
    text,
    sessionId: "s-001",
    project: "test-project",
    agent: "claude",
    timestamp: "2026-04-01T10:00:00Z",
    ...overrides,
  };
}

describe("categorizePrompts", () => {
  it("categorizes slash commands as SKILLS", () => {
    const { categories } = categorizePrompts([
      makePrompt("/retro run the retrospective"),
      makePrompt("/commit these changes"),
    ]);
    expect(categories.SKILLS.length).toBe(2);
  });

  it("categorizes scheduling prompts as SCHEDULED_TASKS", () => {
    const { categories } = categorizePrompts([
      makePrompt("check slack for new messages every morning"),
      makePrompt("set up a cron job to run this daily"),
    ]);
    expect(categories.SCHEDULED_TASKS.length).toBe(2);
  });

  it("categorizes agent-related prompts as AGENTS", () => {
    const { categories } = categorizePrompts([
      makePrompt("create a multi-agent workflow to enrich leads"),
    ]);
    expect(categories.AGENTS.length).toBe(1);
  });

  it("categorizes instruction prompts as CLAUDE_MD", () => {
    const { categories } = categorizePrompts([
      makePrompt("update the CLAUDE.md file with this new rule"),
      makePrompt("from now on always use TypeScript strict mode"),
    ]);
    expect(categories.CLAUDE_MD.length).toBe(2);
  });

  it("filters noise (short prompts, system tags)", () => {
    const { categories, uncategorized } = categorizePrompts([
      makePrompt("ok"),
      makePrompt("<system-reminder>some system text</system-reminder>"),
      makePrompt("[Image: source: screenshot.png]"),
    ]);
    const total = Object.values(categories).reduce((sum, items) => sum + items.length, 0) + uncategorized.length;
    expect(total).toBe(0);
  });

  it("deduplicates identical prompts by normalized prefix", () => {
    const { categories } = categorizePrompts([
      makePrompt("/retro run retrospective", { sessionId: "s-001" }),
      makePrompt("/retro run retrospective", { sessionId: "s-002" }),
      makePrompt("/retro run retrospective", { sessionId: "s-003" }),
    ]);
    expect(categories.SKILLS.length).toBe(1);
    expect(categories.SKILLS[0].count).toBe(3);
    expect(categories.SKILLS[0].sessionIds).toHaveLength(3);
  });

  it("puts unrecognized prompts in uncategorized", () => {
    const { uncategorized } = categorizePrompts([
      makePrompt("explain how the database connection pooling works in this codebase"),
    ]);
    expect(uncategorized.length).toBe(1);
  });
});

// ── getPricing ──────────────────────────────────────────────────────

describe("getPricing", () => {
  it("returns Opus 4.6 pricing for opus model", () => {
    const p = getPricing("claude-opus-4-6-20260401");
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  it("returns legacy Opus pricing for opus 4.0", () => {
    const p = getPricing("claude-opus-4-0-20250101");
    expect(p.input).toBe(15);
    expect(p.output).toBe(75);
  });

  it("returns Sonnet pricing", () => {
    const p = getPricing("claude-sonnet-4-6-20260401");
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  it("applies 6x multiplier for fast mode", () => {
    const p = getPricing("claude-opus-4-6-20260401-fast");
    expect(p.input).toBe(30);
    expect(p.output).toBe(150);
  });

  it("returns default pricing for unknown model", () => {
    const p = getPricing("unknown-model");
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });
});

// ── estimateCost ────────────────────────────────────────────────────

function makeTokenSummary(overrides?: Partial<TokenSummary>): TokenSummary {
  return {
    totalInput: 1_000_000,
    totalOutput: 500_000,
    totalCacheRead: 2_000_000,
    totalCacheCreate: 100_000,
    totalApiCalls: 50,
    byAgent: {
      claude: { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheCreate: 100_000, apiCalls: 50, sessionCount: 5 },
    },
    byProject: {
      "my-project": { input: 1_000_000, output: 500_000, sessionCount: 5 },
    },
    byModel: {
      "claude-sonnet-4-6-20260401": { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheCreate: 100_000, apiCalls: 50 },
    },
    byProjectModel: {},
    ...overrides,
  };
}

describe("estimateCost", () => {
  it("calculates cost using per-model pricing", () => {
    const tokens = makeTokenSummary();
    const result = estimateCost(tokens);
    // Sonnet: $3/M in + $15/M out + $0.30/M cache-read + $3.75/M cache-write
    // = 1M * $3 + 0.5M * $15 + 2M * $0.30 + 0.1M * $3.75
    // = $3 + $7.50 + $0.60 + $0.375 = $11.475
    expect(result.totalCost).toBeCloseTo(11.475, 2);
  });

  it("calculates plan savings", () => {
    const tokens = makeTokenSummary();
    const result = estimateCost(tokens, "Pro");
    expect(result.planSavings).toBeDefined();
    expect(result.planSavings!.planName).toBe("Pro");
    expect(result.planSavings!.planCost).toBe(20);
  });

  it("distributes cost proportionally across projects (fallback)", () => {
    const tokens = makeTokenSummary({
      byProject: {
        "proj-a": { input: 750_000, output: 375_000, sessionCount: 3 },
        "proj-b": { input: 250_000, output: 125_000, sessionCount: 2 },
      },
      byProjectModel: {}, // empty → triggers proportional fallback
    });
    const result = estimateCost(tokens);
    const totalProjectCost = Object.values(result.byProject).reduce((s, c) => s + c, 0);
    expect(totalProjectCost).toBeCloseTo(result.totalCost, 2);
  });

  it("uses byProjectModel for accurate per-project costs when available", () => {
    const tokens = makeTokenSummary({
      byProjectModel: {
        "proj-a": {
          "claude-sonnet-4-6-20260401": { input: 800_000, output: 400_000, cacheRead: 1_500_000, cacheCreate: 80_000, apiCalls: 40 },
        },
        "proj-b": {
          "claude-sonnet-4-6-20260401": { input: 200_000, output: 100_000, cacheRead: 500_000, cacheCreate: 20_000, apiCalls: 10 },
        },
      },
    });
    const result = estimateCost(tokens);
    // proj-a should have ~80% of cost, proj-b ~20%, computed from real pricing
    expect(result.byProject["proj-a"]).toBeGreaterThan(result.byProject["proj-b"]);
    // Both should sum to totalCost (since byProjectModel covers all the same data as byModel)
    const totalProjectCost = Object.values(result.byProject).reduce((s, c) => s + c, 0);
    expect(totalProjectCost).toBeCloseTo(result.totalCost, 2);
  });

  it("returns zero cost for empty token summary", () => {
    const tokens = makeTokenSummary({
      totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheCreate: 0,
      totalApiCalls: 0, byModel: {}, byAgent: {}, byProject: {},
    });
    const result = estimateCost(tokens);
    expect(result.totalCost).toBe(0);
  });
});

// ── diffDigests ─────────────────────────────────────────────────────

function makeReport(overrides?: Partial<DigestReport>): DigestReport {
  return {
    generatedAt: "2026-04-01T10:00:00Z",
    window: { since: "2026-03-25T00:00:00Z", until: "2026-04-01T00:00:00Z" },
    scope: "global",
    totalSessions: 10,
    totalPrompts: 50,
    categories: {
      SKILLS: [{ description: "/retro run", sessionIds: ["s1"], projects: ["p1"], agents: ["claude"], count: 5, category: "SKILLS", lastSeen: "2026-04-01" }],
      AGENTS: [],
      SCHEDULED_TASKS: [],
      CLAUDE_MD: [],
    },
    uncategorized: [],
    tokens: makeTokenSummary(),
    agentScans: [],
    ...overrides,
  };
}

describe("diffDigests", () => {
  it("detects new items", () => {
    const previous = makeReport({ categories: { SKILLS: [], AGENTS: [], SCHEDULED_TASKS: [], CLAUDE_MD: [] } });
    const current = makeReport();
    const diff = diffDigests(current, previous);
    expect(diff.newItems.length).toBe(1);
    expect(diff.newItems[0].description).toBe("/retro run");
  });

  it("detects dropped items", () => {
    const previous = makeReport();
    const current = makeReport({ categories: { SKILLS: [], AGENTS: [], SCHEDULED_TASKS: [], CLAUDE_MD: [] } });
    const diff = diffDigests(current, previous);
    expect(diff.droppedItems.length).toBe(1);
  });

  it("calculates session and prompt deltas", () => {
    const previous = makeReport({ totalSessions: 5, totalPrompts: 20 });
    const current = makeReport({ totalSessions: 10, totalPrompts: 50 });
    const diff = diffDigests(current, previous);
    expect(diff.sessionDelta).toBe(5);
    expect(diff.promptDelta).toBe(30);
  });

  it("detects trending up items", () => {
    const item = { description: "/retro run", sessionIds: ["s1"], projects: ["p1"], agents: ["claude"], count: 3, category: "SKILLS" as const, lastSeen: "2026-03-25" };
    const previous = makeReport({ categories: { SKILLS: [item], AGENTS: [], SCHEDULED_TASKS: [], CLAUDE_MD: [] } });
    const current = makeReport(); // count: 5 vs previous count: 3
    const diff = diffDigests(current, previous);
    expect(diff.trendingUp.length).toBe(1);
  });
});

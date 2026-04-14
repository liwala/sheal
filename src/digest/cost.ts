/**
 * Token cost estimation (#7) and digest diff (#9).
 *
 * Uses REAL per-model pricing from the session data.
 * Pricing source: https://docs.anthropic.com/en/docs/about-claude/pricing
 *
 * Per million tokens (as of 2025):
 *   Opus 4:    $15 input,  $75 output,  $1.875 cache write,  $0.1875 cache read (90% discount)
 *   Sonnet 4:  $3 input,   $15 output,  $3.75 cache write,   $0.30 cache read
 *   Haiku 3.5: $0.80 input, $4 output,  $1.00 cache write,   $0.08 cache read
 */

import type { TokenSummary, CostEstimate, DigestReport, DigestDiff, DigestItem, DigestCategory } from "./types.js";

interface ModelPricing {
  input: number;    // per 1M tokens
  output: number;   // per 1M tokens
  cacheWrite: number; // per 1M tokens
  cacheRead: number;  // per 1M tokens
}

// Model name patterns → pricing (per 1M tokens)
// Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// Last updated: April 2026 — verify periodically as Anthropic adjusts pricing
// Cache write = 1.25x base input, cache read = 0.1x base input
export const MODEL_PRICING: Array<{ pattern: RegExp; pricing: ModelPricing }> = [
  // Opus 4.5+ (including 4.6): $5 in, $25 out
  {
    pattern: /opus.*(4-[5-9]|4\.[5-9])/i,
    pricing: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  },
  // Opus 4.0/4.1 (legacy): $15 in, $75 out
  {
    pattern: /opus/i,
    pricing: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  },
  // Sonnet 4.x: $3 in, $15 out
  {
    pattern: /sonnet/i,
    pricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  },
  // Haiku 4.5: $1 in, $5 out
  {
    pattern: /haiku.*4[.-]5/i,
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
  },
  // Haiku 3.5: $0.80 in, $4 out
  {
    pattern: /haiku/i,
    pricing: { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  },
];

export const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };

export function getPricing(modelName: string): ModelPricing {
  // Fast mode = 6x standard pricing — applies to any model used with Claude Code's /fast toggle
  const isFast = modelName.endsWith("-fast");
  const baseName = isFast ? modelName.replace(/-fast$/, "") : modelName;

  for (const { pattern, pricing } of MODEL_PRICING) {
    if (pattern.test(baseName)) {
      if (isFast) {
        return {
          input: pricing.input * 6,
          output: pricing.output * 6,
          cacheWrite: pricing.cacheWrite * 6,
          cacheRead: pricing.cacheRead * 6,
        };
      }
      return pricing;
    }
  }
  return DEFAULT_PRICING;
}

function prettyModelName(model: string): string {
  if (/opus.*4.*6/i.test(model)) return "Opus 4.6";
  if (/opus/i.test(model)) return "Opus 4";
  if (/sonnet.*4.*6/i.test(model)) return "Sonnet 4.6";
  if (/sonnet/i.test(model)) return "Sonnet 4";
  if (/haiku.*4.*5/i.test(model)) return "Haiku 4.5";
  if (/haiku/i.test(model)) return "Haiku";
  return model;
}

export interface ModelCostBreakdown {
  model: string;
  displayName: string;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

/** Subscription plans */
export const PLANS: Record<string, number> = {
  "Pro": 20,
  "Max 5x": 100,
  "Max 20x": 200,
};

export function estimateCost(tokens: TokenSummary, plan?: string): CostEstimate & { byModelBreakdown: ModelCostBreakdown[] } {
  let totalCost = 0;
  const byModelBreakdown: ModelCostBreakdown[] = [];

  // Calculate cost per model using real pricing
  // Per-call input_tokens from the API already EXCLUDES cache tokens.
  // cache_read and cache_write are separate fields.
  // So: cost = input * input_price + output * output_price + cache_read * cache_read_price + cache_write * cache_write_price
  // (The statusline uses context_window.total_input which INCLUDES cache, so it subtracts. We don't need to.)
  if (tokens.byModel && Object.keys(tokens.byModel).length > 0) {
    for (const [model, data] of Object.entries(tokens.byModel)) {
      const pricing = getPricing(model);

      const inputCost = (data.input / 1_000_000) * pricing.input;
      const outputCost = (data.output / 1_000_000) * pricing.output;
      const cacheReadCost = (data.cacheRead / 1_000_000) * pricing.cacheRead;
      const cacheWriteCost = (data.cacheCreate / 1_000_000) * pricing.cacheWrite;
      const modelTotal = inputCost + outputCost + cacheReadCost + cacheWriteCost;

      totalCost += modelTotal;

      byModelBreakdown.push({
        model,
        displayName: prettyModelName(model),
        apiCalls: data.apiCalls,
        inputTokens: data.input,
        outputTokens: data.output,
        cacheReadTokens: data.cacheRead,
        cacheCreateTokens: data.cacheCreate,
        inputCost,
        outputCost,
        cacheReadCost,
        cacheWriteCost,
        totalCost: modelTotal,
      });
    }
  } else {
    // Fallback: no per-model data, use default pricing
    const pricing = DEFAULT_PRICING;
    totalCost =
      (tokens.totalInput / 1_000_000) * pricing.input +
      (tokens.totalOutput / 1_000_000) * pricing.output +
      (tokens.totalCacheRead / 1_000_000) * pricing.cacheRead +
      (tokens.totalCacheCreate / 1_000_000) * pricing.cacheWrite;
  }

  // Sort by cost descending
  byModelBreakdown.sort((a, b) => b.totalCost - a.totalCost);

  // Per-agent cost (use blended rate from model data)
  const byAgent: Record<string, number> = {};
  for (const [agent, data] of Object.entries(tokens.byAgent)) {
    // Rough estimate: use the proportion of total tokens
    const agentTokens = data.input + data.output;
    const totalTokens = tokens.totalInput + tokens.totalOutput;
    byAgent[agent] = totalTokens > 0 ? totalCost * (agentTokens / totalTokens) : 0;
  }

  // Per-project cost
  const byProject: Record<string, number> = {};
  for (const [project, data] of Object.entries(tokens.byProject)) {
    const projTokens = data.input + data.output;
    const totalTokens = tokens.totalInput + tokens.totalOutput;
    byProject[project] = totalTokens > 0 ? totalCost * (projTokens / totalTokens) : 0;
  }

  // Plan savings calculation
  let planSavings: CostEstimate["planSavings"] | undefined;
  const planName = plan || "Max 20x";
  const planCost = PLANS[planName] || 200;
  if (totalCost > 0) {
    const saved = totalCost - planCost;
    const savedPercent = (saved / totalCost) * 100;
    planSavings = { planName, planCost, apiCost: totalCost, saved, savedPercent };
  }

  return { totalCost, byAgent, byProject, byModelBreakdown, planSavings };
}

/**
 * Compare two digest reports and produce a diff (#9).
 */
export function diffDigests(current: DigestReport, previous: DigestReport): DigestDiff {
  const currentCost = estimateCost(current.tokens);
  const previousCost = estimateCost(previous.tokens);

  const tokenDelta = {
    input: current.tokens.totalInput - previous.tokens.totalInput,
    output: current.tokens.totalOutput - previous.tokens.totalOutput,
    apiCalls: current.tokens.totalApiCalls - previous.tokens.totalApiCalls,
    costDelta: currentCost.totalCost - previousCost.totalCost,
  };

  const categoryDeltas: Record<DigestCategory, number> = {
    SKILLS: 0,
    AGENTS: 0,
    SCHEDULED_TASKS: 0,
    CLAUDE_MD: 0,
  };

  const allCats: DigestCategory[] = ["SKILLS", "AGENTS", "SCHEDULED_TASKS", "CLAUDE_MD"];

  const prevItems = new Map<string, DigestItem>();
  for (const cat of allCats) {
    for (const item of previous.categories[cat]) {
      prevItems.set(item.description, item);
    }
  }
  for (const item of previous.uncategorized) {
    prevItems.set(item.description, item);
  }

  const currItems = new Map<string, DigestItem>();
  for (const cat of allCats) {
    for (const item of current.categories[cat]) {
      currItems.set(item.description, item);
    }
  }
  for (const item of current.uncategorized) {
    currItems.set(item.description, item);
  }

  const newItems: DigestItem[] = [];
  const trendingUp: DigestItem[] = [];
  const trendingDown: DigestItem[] = [];
  const droppedItems: DigestItem[] = [];

  for (const [desc, item] of currItems) {
    const prev = prevItems.get(desc);
    if (!prev) {
      newItems.push(item);
    } else if (item.count > prev.count) {
      trendingUp.push(item);
    }
  }

  for (const [desc, item] of prevItems) {
    const curr = currItems.get(desc);
    if (!curr) {
      droppedItems.push(item);
    } else if (curr.count < item.count) {
      trendingDown.push(curr);
    }
  }

  for (const cat of allCats) {
    categoryDeltas[cat] = current.categories[cat].length - previous.categories[cat].length;
  }

  newItems.sort((a, b) => b.count - a.count);
  trendingUp.sort((a, b) => b.count - a.count);
  trendingDown.sort((a, b) => a.count - b.count);
  droppedItems.sort((a, b) => b.count - a.count);

  return {
    current,
    previous,
    tokenDelta,
    sessionDelta: current.totalSessions - previous.totalSessions,
    promptDelta: current.totalPrompts - previous.totalPrompts,
    categoryDeltas,
    newItems,
    droppedItems,
    trendingUp,
    trendingDown,
  };
}

import { describe, test, expect } from "bun:test";
import { computeCost, getModelPricing } from "./types";
import type { TokenEntry } from "./types";

// ── getModelPricing() ───────────────────────────────────────────────────────

describe("getModelPricing()", () => {
  test("exact match returns correct pricing", () => {
    const p = getModelPricing("gpt-4.1", "codex");
    expect(p.input).toBe(2);
    expect(p.output).toBe(8);
  });

  test("prefix match works for versioned model names", () => {
    const p = getModelPricing("claude-sonnet-4-20250514", "claude");
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  test("substring match works for codex models", () => {
    const p = getModelPricing("GPT-5.3-Codex-Spark", "codex");
    expect(p.input).toBe(1.75);
    expect(p.output).toBe(14);
  });

  test("unknown model returns tool fallback", () => {
    const p = getModelPricing("totally-unknown-model", "claude");
    expect(p.input).toBe(3); // claude fallback
    expect(p.output).toBe(15);
  });

  test("unknown model returns codex fallback for codex tool", () => {
    const p = getModelPricing("totally-unknown-model", "codex");
    expect(p.input).toBe(1.5);
  });

  test("unknown model returns gemini fallback for gemini tool", () => {
    const p = getModelPricing("totally-unknown-model", "gemini");
    expect(p.input).toBe(1.25);
  });
});

// ── computeCost() ───────────────────────────────────────────────────────────

describe("computeCost()", () => {
  test("computes cost correctly for known model", () => {
    const entry: TokenEntry = {
      tool: "claude",
      model: "claude-sonnet-4-20250514",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 200_000,
      cacheWriteTokens: 100_000,
      reasoningTokens: 0,
      timestamp: new Date(),
    };
    // input: 1M * 3/1M = $3, output: 0.5M * 15/1M = $7.5,
    // cacheRead: 0.2M * 0.3/1M = $0.06, cacheWrite: 0.1M * 3.75/1M = $0.375
    const cost = computeCost(entry);
    expect(cost).toBeCloseTo(3 + 7.5 + 0.06 + 0.375, 6);
  });

  test("returns zero cost for zero tokens", () => {
    const entry: TokenEntry = {
      tool: "codex",
      model: "gpt-4.1",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      timestamp: new Date(),
    };
    expect(computeCost(entry)).toBe(0);
  });

  test("uses fallback pricing for unknown model", () => {
    const entry: TokenEntry = {
      tool: "gemini",
      model: "gemini-unknown",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      timestamp: new Date(),
    };
    // gemini fallback input = 1.25 per 1M
    expect(computeCost(entry)).toBeCloseTo(1.25, 6);
  });
});

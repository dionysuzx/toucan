import { describe, test, expect } from "bun:test";
import {
  bar, fmtCost, fmtTokens, fmtPct, fmtTimeDiff, visibleLen, pad,
  fmtUnixReset, renderUsage,
} from "./tui";
import { parseGeminiBuckets } from "./quota";
import type { QuotaData, ClaudeQuota, CodexQuota, GeminiQuota } from "./types";

// ── Helper: strip ANSI codes for readable assertions ────────────────────────

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── bar() ───────────────────────────────────────────────────────────────────

describe("bar()", () => {
  test("0% fraction → all empty", () => {
    const result = strip(bar(0, 10));
    expect(result).toBe("░".repeat(10));
  });

  test("100% fraction → all filled", () => {
    const result = strip(bar(1, 10));
    expect(result).toBe("█".repeat(10));
  });

  test("50% fraction → half and half", () => {
    const result = strip(bar(0.5, 10));
    expect(result).toBe("█████░░░░░");
  });

  test("clamps fraction > 1 to full bar", () => {
    const result = strip(bar(1.5, 10));
    expect(result).toBe("█".repeat(10));
  });

  test("clamps negative fraction to empty bar", () => {
    const result = strip(bar(-0.5, 10));
    expect(result).toBe("░".repeat(10));
  });

  test("NaN fraction → empty bar (clamped)", () => {
    const result = strip(bar(NaN, 10));
    // Math.max(0, Math.min(1, NaN)) = Math.max(0, NaN) = 0
    expect(result).toBe("░".repeat(10));
  });

  test("width 0 → empty string", () => {
    const result = strip(bar(0.5, 0));
    expect(result).toBe("");
  });
});

// ── fmtCost() ───────────────────────────────────────────────────────────────

describe("fmtCost()", () => {
  test("thousands", () => {
    expect(fmtCost(1500)).toBe("$1.5k");
  });

  test("hundreds", () => {
    expect(fmtCost(123.456)).toBe("$123");
  });

  test("dollars", () => {
    expect(fmtCost(5.678)).toBe("$5.68");
  });

  test("cents", () => {
    expect(fmtCost(0.05)).toBe("$0.050");
  });

  test("sub-cent", () => {
    expect(fmtCost(0.001)).toBe("$0.0010");
  });

  test("zero", () => {
    expect(fmtCost(0)).toBe("$0.0000");
  });
});

// ── fmtTokens() ─────────────────────────────────────────────────────────────

describe("fmtTokens()", () => {
  test("billions", () => {
    expect(fmtTokens(2_500_000_000)).toBe("2.5B");
  });

  test("millions", () => {
    expect(fmtTokens(1_234_567)).toBe("1.2M");
  });

  test("thousands", () => {
    expect(fmtTokens(5_678)).toBe("5.7K");
  });

  test("small", () => {
    expect(fmtTokens(42)).toBe("42");
  });

  test("zero", () => {
    expect(fmtTokens(0)).toBe("0");
  });
});

// ── fmtPct() ────────────────────────────────────────────────────────────────

describe("fmtPct()", () => {
  test("large pct rounds to integer", () => {
    expect(fmtPct(85.3)).toBe("85%");
  });

  test("small pct shows one decimal", () => {
    expect(fmtPct(3.14)).toBe("3.1%");
  });

  test("zero", () => {
    expect(fmtPct(0)).toBe("0.0%");
  });
});

// ── visibleLen() ────────────────────────────────────────────────────────────

describe("visibleLen()", () => {
  test("plain text", () => {
    expect(visibleLen("hello")).toBe(5);
  });

  test("text with ANSI codes", () => {
    expect(visibleLen("\x1b[31mred\x1b[0m")).toBe(3);
  });

  test("empty string", () => {
    expect(visibleLen("")).toBe(0);
  });
});

// ── pad() ───────────────────────────────────────────────────────────────────

describe("pad()", () => {
  test("left align", () => {
    expect(pad("hi", 5)).toBe("hi   ");
  });

  test("right align", () => {
    expect(pad("hi", 5, "right")).toBe("   hi");
  });

  test("no padding needed", () => {
    expect(pad("hello", 3)).toBe("hello");
  });

  test("pads ANSI text by visible length", () => {
    const text = "\x1b[31mhi\x1b[0m";
    const result = pad(text, 5);
    expect(visibleLen(result)).toBe(5);
  });
});

// ── fmtTimeDiff() ───────────────────────────────────────────────────────────

describe("fmtTimeDiff()", () => {
  test("past time → 'now'", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(fmtTimeDiff(past)).toBe("now");
  });

  test("future time → hours and minutes", () => {
    const future = new Date(Date.now() + 3 * 3_600_000 + 30 * 60_000).toISOString();
    expect(fmtTimeDiff(future)).toBe("3h 30m");
  });

  test("future time < 1h → minutes only", () => {
    const future = new Date(Date.now() + 45 * 60_000).toISOString();
    expect(fmtTimeDiff(future)).toBe("45m");
  });

  test("invalid string → empty", () => {
    expect(fmtTimeDiff("not-a-date")).toBe("");
  });
});

// ── fmtUnixReset() ─────────────────────────────────────────────────────────

describe("fmtUnixReset()", () => {
  test("0 → empty string", () => {
    expect(fmtUnixReset(0)).toBe("");
  });

  test("unix seconds → valid time string", () => {
    const ts = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now, today
    const result = fmtUnixReset(ts);
    expect(result).toMatch(/^\d{2}:\d{2}/);
  });

  test("millisecond timestamp (>1e12) → treated as ms", () => {
    const ts = Date.now() + 3_600_000; // 1 hour from now in ms
    const result = fmtUnixReset(ts);
    expect(result).toMatch(/^\d{2}:\d{2}/);
  });
});

// ── renderUsage() ───────────────────────────────────────────────────────────

describe("renderUsage()", () => {
  test("null quota → shows fetching message", () => {
    const lines = renderUsage(null, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("Fetching quota data...");
  });

  test("all errors → shows error messages for each tool", () => {
    const quota: QuotaData = {
      claude: null,
      codex: null,
      gemini: null,
      fetchedAt: new Date(),
      errors: {
        claude: "no token",
        codex: "no sessions",
        gemini: "auth failed",
      },
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("Could not fetch quota: no token");
    expect(text).toContain("Could not fetch quota: no sessions");
    expect(text).toContain("Could not fetch quota: auth failed");
  });

  test("Claude section shows correct percentages (utilization is 0-100)", () => {
    const quota: QuotaData = {
      claude: {
        session: { utilization: 38, resetsAt: null },
        weekly: { utilization: 32, resetsAt: null },
        weeklySonnet: { utilization: 0, resetsAt: null },
        extraUsage: { isEnabled: false, utilization: null },
        subscriptionType: "max",
      },
      codex: null,
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("38% used");
    expect(text).toContain("32% used");
    expect(text).toContain("0% used");
    expect(text).not.toContain("3800%");
    expect(text).not.toContain("3200%");
    expect(text).toContain("Claude Code (Max)");
  });

  test("Claude extra usage enabled shows bar", () => {
    const quota: QuotaData = {
      claude: {
        session: { utilization: 10, resetsAt: null },
        weekly: { utilization: 5, resetsAt: null },
        weeklySonnet: null,
        extraUsage: { isEnabled: true, utilization: 25 },
        subscriptionType: "pro",
      },
      codex: null,
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("25% used");
    expect(text).not.toContain("Extra usage not enabled");
  });

  test("Codex section shows % left correctly", () => {
    const quota: QuotaData = {
      claude: null,
      codex: {
        primary: { usedPercent: 1, windowMinutes: 300, resetsAt: 0 },
        secondary: { usedPercent: 8, windowMinutes: 10080, resetsAt: 0 },
        planType: "plus",
        staleSeconds: 60,
      },
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("99% left");
    expect(text).toContain("92% left");
    expect(text).toContain("Codex CLI (Plus)");
    expect(text).not.toContain("data from"); // only shows if stale > 900s
  });

  test("Codex stale data warning when > 15 min old", () => {
    const quota: QuotaData = {
      claude: null,
      codex: {
        primary: { usedPercent: 5, windowMinutes: 300, resetsAt: 0 },
        secondary: null,
        planType: null,
        staleSeconds: 1200, // 20 minutes
      },
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("data from 20 min ago");
  });

  test("Codex no rate limit data", () => {
    const quota: QuotaData = {
      claude: null,
      codex: {
        primary: null,
        secondary: null,
        planType: null,
        staleSeconds: 0,
      },
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("No rate limit data");
  });

  test("Gemini section shows buckets with correct percentages", () => {
    const quota: QuotaData = {
      claude: null,
      codex: null,
      gemini: {
        buckets: [
          { modelId: "gemini-2.5-pro", remainingFraction: 1.0, resetTime: new Date(Date.now() + 86_400_000).toISOString() },
          { modelId: "gemini-2.5-flash", remainingFraction: 0.989, resetTime: new Date(Date.now() + 30_000_000).toISOString() },
        ],
        account: "user@gmail.com",
      },
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("100.0%");
    expect(text).toContain("98.9%");
    expect(text).toContain("gemini-2.5-pro");
    expect(text).toContain("gemini-2.5-flash");
    expect(text).toContain("user@gmail.com");
  });

  test("Gemini section matches real API response shape (no remainingAmount, has _vertex duplicates filtered)", () => {
    // This matches the actual retrieveUserQuota response format:
    // buckets have: resetTime, tokenType, modelId, remainingFraction
    // NO remainingAmount or maxValue fields
    // _vertex duplicates should be filtered by quota.ts before reaching renderUsage
    const resetSoon = new Date(Date.now() + 6 * 3_600_000 + 2 * 60_000).toISOString();
    const resetLater = new Date(Date.now() + 22 * 3_600_000).toISOString();
    const resetMid = new Date(Date.now() + 21 * 3_600_000 + 3 * 60_000).toISOString();

    const quota: QuotaData = {
      claude: null,
      codex: null,
      gemini: {
        buckets: [
          { modelId: "gemini-2.5-flash", remainingFraction: 0.993, resetTime: resetSoon },
          { modelId: "gemini-2.5-flash-lite", remainingFraction: 0.998, resetTime: resetMid },
          { modelId: "gemini-2.5-pro", remainingFraction: 0.998, resetTime: resetLater },
          { modelId: "gemini-3-flash-preview", remainingFraction: 0.993, resetTime: resetSoon },
          { modelId: "gemini-3.1-pro-preview", remainingFraction: 0.998, resetTime: resetLater },
        ],
        account: "user@gmail.com",
      },
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");

    // All 5 models present
    expect(text).toContain("gemini-2.5-flash");
    expect(text).toContain("gemini-2.5-flash-lite");
    expect(text).toContain("gemini-2.5-pro");
    expect(text).toContain("gemini-3-flash-preview");
    expect(text).toContain("gemini-3.1-pro-preview");

    // Correct percentages
    expect(text).toContain("99.3%");
    expect(text).toContain("99.8%");

    // Reset times shown
    expect(text).toContain("resets in 6h");
    expect(text).toContain("resets in 22h");
    expect(text).toContain("resets in 21h");

    // No _vertex models
    expect(text).not.toContain("_vertex");

    // Account shown in header
    expect(text).toContain("Gemini CLI (user@gmail.com)");
  });

  test("Gemini no buckets", () => {
    const quota: QuotaData = {
      claude: null,
      codex: null,
      gemini: { buckets: [], account: null },
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("No quota buckets returned");
  });

  test("all three tools with data renders without crash", () => {
    const quota: QuotaData = {
      claude: {
        session: { utilization: 83, resetsAt: "2026-02-22T19:00:00Z" },
        weekly: { utilization: 36, resetsAt: "2026-02-23T00:00:00Z" },
        weeklySonnet: { utilization: 0, resetsAt: null },
        extraUsage: { isEnabled: false, utilization: null },
        subscriptionType: "max",
      },
      codex: {
        primary: { usedPercent: 1, windowMinutes: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
        secondary: { usedPercent: 8, windowMinutes: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 },
        planType: "plus",
        staleSeconds: 30,
      },
      gemini: {
        buckets: [
          { modelId: "gemini-2.5-pro", remainingFraction: 1.0, resetTime: new Date(Date.now() + 86_400_000).toISOString() },
        ],
        account: "test@gmail.com",
      },
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    expect(lines.length).toBeGreaterThan(20);
    // Should contain all three sections
    const text = lines.map(strip).join("\n");
    expect(text).toContain("Claude Code (Max)");
    expect(text).toContain("Codex CLI (Plus)");
    expect(text).toContain("Gemini CLI (test@gmail.com)");
  });

  test("utilization at exactly 100% renders correctly", () => {
    const quota: QuotaData = {
      claude: {
        session: { utilization: 100, resetsAt: null },
        weekly: { utilization: 100, resetsAt: null },
        weeklySonnet: null,
        extraUsage: { isEnabled: false, utilization: null },
        subscriptionType: "max",
      },
      codex: null,
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("100% used");
  });

  test("utilization > 100 is clamped in bar but shows real percentage", () => {
    const quota: QuotaData = {
      claude: {
        session: { utilization: 120, resetsAt: null },
        weekly: { utilization: 50, resetsAt: null },
        weeklySonnet: null,
        extraUsage: { isEnabled: false, utilization: null },
        subscriptionType: "max",
      },
      codex: null,
      gemini: null,
      fetchedAt: new Date(),
      errors: {},
    };
    // Should not crash (bar clamps to 1.0)
    const lines = renderUsage(quota, 100);
    const text = lines.map(strip).join("\n");
    expect(text).toContain("120% used");
  });
});

// ── parseGeminiBuckets() ─────────────────────────────────────────────────

describe("parseGeminiBuckets()", () => {
  test("parses real API response — filters _vertex, keeps remainingFraction", () => {
    // Exact shape from the real retrieveUserQuota API response
    const rawBuckets = [
      { resetTime: "2026-02-23T00:40:15Z", tokenType: "REQUESTS", modelId: "gemini-2.0-flash", remainingFraction: 0.993 },
      { resetTime: "2026-02-23T00:40:15Z", tokenType: "REQUESTS", modelId: "gemini-2.0-flash_vertex", remainingFraction: 0.993 },
      { resetTime: "2026-02-23T00:40:15Z", tokenType: "REQUESTS", modelId: "gemini-2.5-flash", remainingFraction: 0.993 },
      { resetTime: "2026-02-23T15:41:15Z", tokenType: "REQUESTS", modelId: "gemini-2.5-flash-lite", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T15:41:15Z", tokenType: "REQUESTS", modelId: "gemini-2.5-flash-lite_vertex", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T00:40:15Z", tokenType: "REQUESTS", modelId: "gemini-2.5-flash_vertex", remainingFraction: 0.993 },
      { resetTime: "2026-02-23T16:38:32Z", tokenType: "REQUESTS", modelId: "gemini-2.5-pro", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T16:38:32Z", tokenType: "REQUESTS", modelId: "gemini-2.5-pro_vertex", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T00:40:15Z", tokenType: "REQUESTS", modelId: "gemini-3-flash-preview", remainingFraction: 0.993 },
      { resetTime: "2026-02-23T00:40:15Z", tokenType: "REQUESTS", modelId: "gemini-3-flash-preview_vertex", remainingFraction: 0.993 },
      { resetTime: "2026-02-23T16:38:32Z", tokenType: "REQUESTS", modelId: "gemini-3-pro-preview", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T16:38:32Z", tokenType: "REQUESTS", modelId: "gemini-3-pro-preview_vertex", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T16:38:32Z", tokenType: "REQUESTS", modelId: "gemini-3.1-pro-preview", remainingFraction: 0.998 },
      { resetTime: "2026-02-23T16:38:32Z", tokenType: "REQUESTS", modelId: "gemini-3.1-pro-preview_vertex", remainingFraction: 0.998 },
    ];

    const buckets = parseGeminiBuckets(rawBuckets);

    // No _vertex models
    expect(buckets.every(b => !b.modelId.endsWith("_vertex"))).toBe(true);

    // Should have 7 non-vertex models
    expect(buckets.length).toBe(7);

    // All models present
    const ids = buckets.map(b => b.modelId);
    expect(ids).toContain("gemini-2.0-flash");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("gemini-2.5-flash-lite");
    expect(ids).toContain("gemini-2.5-pro");
    expect(ids).toContain("gemini-3-flash-preview");
    expect(ids).toContain("gemini-3-pro-preview");
    expect(ids).toContain("gemini-3.1-pro-preview");

    // Fraction preserved directly (not computed from remainingValue/maxValue)
    const flash = buckets.find(b => b.modelId === "gemini-2.5-flash")!;
    expect(flash.remainingFraction).toBe(0.993);
    expect(flash.resetTime).toBe("2026-02-23T00:40:15Z");

    const pro = buckets.find(b => b.modelId === "gemini-2.5-pro")!;
    expect(pro.remainingFraction).toBe(0.998);
  });

  test("handles null/undefined input", () => {
    expect(parseGeminiBuckets(null as any)).toEqual([]);
    expect(parseGeminiBuckets(undefined as any)).toEqual([]);
  });

  test("filters out buckets missing modelId or remainingFraction", () => {
    const raw = [
      { resetTime: "2026-02-23T00:00:00Z", tokenType: "REQUESTS", modelId: "gemini-2.5-flash", remainingFraction: 0.5 },
      { resetTime: "2026-02-23T00:00:00Z", tokenType: "REQUESTS", remainingFraction: 0.5 }, // no modelId
      { resetTime: "2026-02-23T00:00:00Z", tokenType: "REQUESTS", modelId: "gemini-2.5-pro" }, // no remainingFraction
    ];
    const buckets = parseGeminiBuckets(raw);
    expect(buckets.length).toBe(1);
    expect(buckets[0].modelId).toBe("gemini-2.5-flash");
  });

  test("handles remainingFraction of 0 (fully used)", () => {
    const raw = [
      { resetTime: "2026-02-23T00:00:00Z", tokenType: "REQUESTS", modelId: "gemini-2.5-flash", remainingFraction: 0 },
    ];
    const buckets = parseGeminiBuckets(raw);
    expect(buckets.length).toBe(1);
    expect(buckets[0].remainingFraction).toBe(0);
  });
});

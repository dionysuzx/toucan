import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanAll } from "./scan";

// ── scanAll() with empty HOME ────────────────────────────────────────────────

describe("scanAll()", () => {
  test("returns zero entries when no data directories exist", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-empty-"));
    try {
      const result = await scanAll(undefined, home);
      expect(result.claude.entries).toBe(0);
      expect(result.codex.entries).toBe(0);
      expect(result.gemini.entries).toBe(0);
      expect(result.entries.length).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("onProgress callback is called", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-progress-"));
    const messages: string[] = [];
    try {
      await scanAll((msg) => messages.push(msg), home);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.includes("Claude"))).toBe(true);
      expect(messages.some((m) => m.includes("Codex"))).toBe(true);
      expect(messages.some((m) => m.includes("Gemini"))).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ── Claude scanner ───────────────────────────────────────────────────────────

describe("scanClaude()", () => {
  test("parses Claude JSONL session data", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-claude-"));
    const projectDir = join(home, ".claude", "projects", "test-project");
    await mkdir(projectDir, { recursive: true });

    const sessionData = [
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
        },
        timestamp: "2026-02-20T10:00:00Z",
      }),
      JSON.stringify({
        type: "user",
        message: { content: "hello" },
        timestamp: "2026-02-20T10:01:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
        timestamp: "2026-02-20T10:02:00Z",
      }),
    ].join("\n");

    await writeFile(join(projectDir, "session1.jsonl"), sessionData);

    try {
      const result = await scanAll(undefined, home);
      expect(result.claude.entries).toBe(2);
      expect(result.claude.totalInputTokens).toBe(300);
      expect(result.claude.totalOutputTokens).toBe(150);
      expect(result.claude.totalCacheReadTokens).toBe(10);
      expect(result.claude.totalCacheWriteTokens).toBe(5);
      expect(result.claude.models.length).toBe(1);
      expect(result.claude.models[0].model).toBe("claude-sonnet-4-20250514");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("skips non-assistant entries and malformed JSON", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-claude-skip-"));
    const projectDir = join(home, ".claude", "projects", "test");
    await mkdir(projectDir, { recursive: true });

    const sessionData = [
      "not valid json",
      JSON.stringify({ type: "user", message: { content: "hi" }, timestamp: "2026-02-20T10:00:00Z" }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 50, output_tokens: 25 } },
        timestamp: "2026-02-20T10:01:00Z",
      }),
    ].join("\n");

    await writeFile(join(projectDir, "session.jsonl"), sessionData);

    try {
      const result = await scanAll(undefined, home);
      expect(result.claude.entries).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ── Codex scanner — multi-model per session ──────────────────────────────────

describe("scanCodex()", () => {
  test("attributes tokens to correct model when model changes mid-session", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-codex-"));
    const dayDir = join(home, ".codex", "sessions", "2026", "02", "20");
    await mkdir(dayDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        type: "session_meta",
        payload: { model: "gpt-4.1" },
        timestamp: "2026-02-20T10:00:00Z",
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 500, output_tokens: 200, cached_input_tokens: 0 } },
        },
        timestamp: "2026-02-20T10:01:00Z",
      }),
      JSON.stringify({
        type: "turn_context",
        payload: { model: "gpt-4.1-mini" },
        timestamp: "2026-02-20T10:05:00Z",
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 10 } },
        },
        timestamp: "2026-02-20T10:06:00Z",
      }),
    ].join("\n");

    await writeFile(join(dayDir, "rollout-abc.jsonl"), sessionLines);

    try {
      const result = await scanAll(undefined, home);
      expect(result.codex.entries).toBe(2);
      expect(result.codex.models.length).toBe(2);

      const gpt41 = result.codex.models.find((m) => m.model === "gpt-4.1");
      const gpt41mini = result.codex.models.find((m) => m.model === "gpt-4.1-mini");

      expect(gpt41).toBeDefined();
      expect(gpt41!.entries).toBe(1);
      expect(gpt41!.inputTokens).toBe(500);
      expect(gpt41!.outputTokens).toBe(200);

      expect(gpt41mini).toBeDefined();
      expect(gpt41mini!.entries).toBe(1);
      expect(gpt41mini!.inputTokens).toBe(90); // 100 - 10 cached
      expect(gpt41mini!.outputTokens).toBe(50);
      expect(gpt41mini!.cacheReadTokens).toBe(10);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("handles session with no model info gracefully", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-codex-nomodel-"));
    const dayDir = join(home, ".codex", "sessions", "2026", "02", "20");
    await mkdir(dayDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 100, output_tokens: 50 } },
        },
        timestamp: "2026-02-20T10:00:00Z",
      }),
    ].join("\n");

    await writeFile(join(dayDir, "rollout-x.jsonl"), sessionLines);

    try {
      const result = await scanAll(undefined, home);
      expect(result.codex.entries).toBe(1);
      expect(result.codex.models[0].model).toBe("codex-unknown");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("subtracts cached tokens from input tokens correctly", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-codex-cache-"));
    const dayDir = join(home, ".codex", "sessions", "2026", "02", "20");
    await mkdir(dayDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        type: "session_meta",
        payload: { model: "o4-mini" },
        timestamp: "2026-02-20T10:00:00Z",
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              output_tokens: 200,
              cached_input_tokens: 800,
              reasoning_output_tokens: 150,
            },
          },
        },
        timestamp: "2026-02-20T10:01:00Z",
      }),
    ].join("\n");

    await writeFile(join(dayDir, "rollout-cache.jsonl"), sessionLines);

    try {
      const result = await scanAll(undefined, home);
      expect(result.codex.entries).toBe(1);
      const model = result.codex.models[0];
      expect(model.inputTokens).toBe(200); // 1000 - 800
      expect(model.cacheReadTokens).toBe(800);
      expect(model.reasoningTokens).toBe(150);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ── Gemini scanner ───────────────────────────────────────────────────────────

describe("scanGemini()", () => {
  test("parses Gemini session JSON", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-gemini-"));
    const chatDir = join(home, ".gemini", "tmp", "abc123", "chats");
    await mkdir(chatDir, { recursive: true });

    const session = {
      messages: [
        { type: "user", content: "hello", timestamp: "2026-02-20T10:00:00Z" },
        {
          type: "gemini",
          model: "gemini-2.5-pro",
          tokens: { input: 300, output: 150, cached: 20, thoughts: 50 },
          timestamp: "2026-02-20T10:01:00Z",
        },
        {
          type: "gemini",
          model: "gemini-2.5-flash",
          tokens: { input: 100, output: 50, cached: 0, thoughts: 0 },
          timestamp: "2026-02-20T10:02:00Z",
        },
      ],
    };

    await writeFile(join(chatDir, "session-001.json"), JSON.stringify(session));

    try {
      const result = await scanAll(undefined, home);
      expect(result.gemini.entries).toBe(2);
      expect(result.gemini.totalInputTokens).toBe(400);
      expect(result.gemini.totalOutputTokens).toBe(200);
      expect(result.gemini.totalCacheReadTokens).toBe(20);
      expect(result.gemini.totalReasoningTokens).toBe(50);
      expect(result.gemini.models.length).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("ignores non-session JSON files", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-gemini-nonses-"));
    const chatDir = join(home, ".gemini", "tmp", "abc123", "chats");
    await mkdir(chatDir, { recursive: true });

    // File that doesn't start with "session-"
    await writeFile(join(chatDir, "other.json"), JSON.stringify({ messages: [] }));

    try {
      const result = await scanAll(undefined, home);
      expect(result.gemini.entries).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ── Aggregation ─────────────────────────────────────────────────────────────

describe("aggregation", () => {
  test("session counting uses 5-minute gap heuristic", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-sessions-"));
    const projectDir = join(home, ".claude", "projects", "test");
    await mkdir(projectDir, { recursive: true });

    // Two entries 1 min apart = 1 session, then 10 min gap, then another = 2 sessions
    const entries = [
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: "2026-02-20T10:00:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: "2026-02-20T10:01:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: "2026-02-20T10:11:00Z",
      }),
    ].join("\n");

    await writeFile(join(projectDir, "session.jsonl"), entries);

    try {
      const result = await scanAll(undefined, home);
      expect(result.claude.sessions).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("daily usage groups by date", async () => {
    const home = await mkdtemp(join(tmpdir(), "toucan-daily-"));
    const projectDir = join(home, ".claude", "projects", "test");
    await mkdir(projectDir, { recursive: true });

    const entries = [
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 100, output_tokens: 50 } },
        timestamp: "2026-02-20T10:00:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 200, output_tokens: 100 } },
        timestamp: "2026-02-21T10:00:00Z",
      }),
    ].join("\n");

    await writeFile(join(projectDir, "session.jsonl"), entries);

    try {
      const result = await scanAll(undefined, home);
      expect(result.claude.daily.length).toBe(2);
      expect(result.claude.daily[0].date).toBe("2026-02-20");
      expect(result.claude.daily[1].date).toBe("2026-02-21");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { TokenEntry, ToolName, ToolSummary, ModelUsage, DayUsage } from "./types";
import { computeCost } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function* walkFiles(dir: string, ext?: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, ext);
    } else if (!ext || entry.name.endsWith(ext)) {
      yield full;
    }
  }
}

function parseDate(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Claude Code Scanner ─────────────────────────────────────────────────────
// Format: JSONL in ~/.claude/projects/<slug>/<session>.jsonl
// Token data on "assistant" entries at message.usage.*

async function scanClaude(home?: string): Promise<TokenEntry[]> {
  const base = join(home ?? homedir(), ".claude", "projects");
  if (!(await exists(base))) return [];

  const entries: TokenEntry[] = [];

  for await (const file of walkFiles(base, ".jsonl")) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      if (obj.type !== "assistant" || !obj.message?.usage) continue;

      const usage = obj.message.usage;
      const ts = parseDate(obj.timestamp);
      if (!ts) continue;

      entries.push({
        tool: "claude",
        model: obj.message.model ?? "unknown",
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        reasoningTokens: 0,
        timestamp: ts,
      });
    }
  }

  return entries;
}

// ── Codex CLI Scanner ───────────────────────────────────────────────────────
// Format: JSONL in ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl
// Token data in event_msg entries where payload.type == "token_count"
// Model found in session_meta, turn_context, or rate_limits

async function scanCodex(home?: string): Promise<TokenEntry[]> {
  const base = join(home ?? homedir(), ".codex", "sessions");
  if (!(await exists(base))) return [];

  const entries: TokenEntry[] = [];

  for await (const file of walkFiles(base, ".jsonl")) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    // Single pass: track current model as it changes and attribute each
    // token_count event to the most recently seen model
    let currentModel = "codex-unknown";
    const lines = content.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // Update current model from any source that carries it
      if (obj.type === "session_meta" && obj.payload?.model) {
        currentModel = obj.payload.model;
      } else if (obj.type === "turn_context" && obj.payload?.model) {
        currentModel = obj.payload.model;
      } else if (obj.type === "event_msg" && obj.payload?.rate_limits?.limit_name) {
        currentModel = obj.payload.rate_limits.limit_name;
      }

      // Extract token_count events using last_token_usage (per-turn, not cumulative)
      if (
        obj.type !== "event_msg" ||
        obj.payload?.type !== "token_count" ||
        !obj.payload?.info?.last_token_usage
      ) {
        continue;
      }

      const ts = parseDate(obj.timestamp);
      if (!ts) continue;

      const usage = obj.payload.info.last_token_usage;
      entries.push({
        tool: "codex",
        model: currentModel,
        inputTokens: Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0)),
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cached_input_tokens ?? 0,
        cacheWriteTokens: 0,
        reasoningTokens: usage.reasoning_output_tokens ?? 0,
        timestamp: ts,
      });
    }
  }

  return entries;
}

// ── Gemini CLI Scanner ──────────────────────────────────────────────────────
// Format: JSON (one file per session) in ~/.gemini/tmp/<hash>/chats/session-*.json
// Token data on "gemini" type messages at messages[n].tokens.*

async function scanGemini(home?: string): Promise<TokenEntry[]> {
  const base = join(home ?? homedir(), ".gemini", "tmp");
  if (!(await exists(base))) return [];

  const entries: TokenEntry[] = [];

  for await (const file of walkFiles(base, ".json")) {
    if (!basename(file).startsWith("session-")) continue;

    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    let session: any;
    try {
      session = JSON.parse(content);
    } catch {
      continue;
    }

    if (!Array.isArray(session.messages)) continue;

    for (const msg of session.messages) {
      if (msg.type !== "gemini" || !msg.tokens) continue;

      const ts = parseDate(msg.timestamp);
      if (!ts) continue;

      entries.push({
        tool: "gemini",
        model: msg.model ?? "gemini-unknown",
        inputTokens: msg.tokens.input ?? 0,
        outputTokens: msg.tokens.output ?? 0,
        cacheReadTokens: msg.tokens.cached ?? 0,
        cacheWriteTokens: 0,
        reasoningTokens: msg.tokens.thoughts ?? 0,
        timestamp: ts,
      });
    }
  }

  return entries;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function countSessions(entries: TokenEntry[], tool: ToolName): number {
  // Approximate: count unique date+hour combos as "sessions"
  // For Claude, each JSONL file is a session; for Gemini, each JSON file.
  // Since we don't track file boundaries, use time-gap heuristic:
  // group entries within 5 minutes as same session
  const sorted = entries
    .filter((e) => e.tool === tool)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (sorted.length === 0) return 0;
  let sessions = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime();
    if (gap > 5 * 60 * 1000) sessions++;
  }
  return sessions;
}

function buildModelUsage(entries: TokenEntry[]): ModelUsage[] {
  const map = new Map<string, ModelUsage>();

  for (const e of entries) {
    const key = `${e.tool}:${e.model}`;
    let m = map.get(key);
    if (!m) {
      m = {
        model: e.model,
        tool: e.tool,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        entries: 0,
      };
      map.set(key, m);
    }
    m.inputTokens += e.inputTokens;
    m.outputTokens += e.outputTokens;
    m.cacheReadTokens += e.cacheReadTokens;
    m.cacheWriteTokens += e.cacheWriteTokens;
    m.reasoningTokens += e.reasoningTokens;
    m.costUsd += computeCost(e);
    m.entries++;
  }

  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function buildDailyUsage(entries: TokenEntry[]): DayUsage[] {
  const map = new Map<string, DayUsage>();

  for (const e of entries) {
    const key = toDateKey(e.timestamp);
    let d = map.get(key);
    if (!d) {
      d = { date: key, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, entries: 0 };
      map.set(key, d);
    }
    d.inputTokens += e.inputTokens;
    d.outputTokens += e.outputTokens;
    d.cacheTokens += e.cacheReadTokens + e.cacheWriteTokens;
    d.costUsd += computeCost(e);
    d.entries++;
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildToolSummary(entries: TokenEntry[], tool: ToolName): ToolSummary {
  const toolEntries = entries.filter((e) => e.tool === tool);
  const models = buildModelUsage(toolEntries);
  const daily = buildDailyUsage(toolEntries);

  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalReasoning = 0;

  for (const e of toolEntries) {
    totalCost += computeCost(e);
    totalIn += e.inputTokens;
    totalOut += e.outputTokens;
    totalCacheRead += e.cacheReadTokens;
    totalCacheWrite += e.cacheWriteTokens;
    totalReasoning += e.reasoningTokens;
  }

  return {
    tool,
    sessions: countSessions(entries, tool),
    entries: toolEntries.length,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalCacheReadTokens: totalCacheRead,
    totalCacheWriteTokens: totalCacheWrite,
    totalReasoningTokens: totalReasoning,
    totalCostUsd: totalCost,
    models,
    daily,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ScanResult = {
  entries: TokenEntry[];
  claude: ToolSummary;
  codex: ToolSummary;
  gemini: ToolSummary;
};

export async function scanAll(
  onProgress?: (msg: string) => void,
  home?: string,
): Promise<ScanResult> {
  onProgress?.("Scanning Claude Code sessions...");
  const claudeEntries = await scanClaude(home);
  onProgress?.(`  found ${claudeEntries.length} entries`);

  onProgress?.("Scanning Codex CLI sessions...");
  const codexEntries = await scanCodex(home);
  onProgress?.(`  found ${codexEntries.length} entries`);

  onProgress?.("Scanning Gemini CLI sessions...");
  const geminiEntries = await scanGemini(home);
  onProgress?.(`  found ${geminiEntries.length} entries`);

  const allEntries = [...claudeEntries, ...codexEntries, ...geminiEntries];

  return {
    entries: allEntries,
    claude: buildToolSummary(allEntries, "claude"),
    codex: buildToolSummary(allEntries, "codex"),
    gemini: buildToolSummary(allEntries, "gemini"),
  };
}

export type ToolName = "claude" | "codex" | "gemini";

export type TokenEntry = {
  tool: ToolName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  timestamp: Date;
};

export type ModelUsage = {
  model: string;
  tool: ToolName;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  costUsd: number;
  entries: number;
};

export type DayUsage = {
  date: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  entries: number;
};

export type ToolSummary = {
  tool: ToolName;
  sessions: number;
  entries: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalCostUsd: number;
  models: ModelUsage[];
  daily: DayUsage[];
};

export type AggregateData = {
  tools: ToolSummary[];
  allModels: ModelUsage[];
  allDaily: DayUsage[];
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalReasoningTokens: number;
  totalSessions: number;
  totalEntries: number;
};

// Pricing per 1M tokens (USD)
// Sources: Anthropic, OpenAI, Google public pricing pages
type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6":           { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25 },
  "claude-opus-4-5-20251101":  { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25 },
  "claude-sonnet-4-20250514":  { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75 },
  "claude-sonnet-4-6":         { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1,    output: 5,    cacheRead: 0.10,  cacheWrite: 1.25 },
  "claude-haiku-3-5-20241022": { input: 0.80, output: 4,    cacheRead: 0.08,  cacheWrite: 1 },
  // OpenAI
  "gpt-4.1":                   { input: 2,    output: 8,    cacheRead: 0.50,  cacheWrite: 2 },
  "gpt-4.1-mini":              { input: 0.40, output: 1.60, cacheRead: 0.10,  cacheWrite: 0.40 },
  "gpt-4.1-nano":              { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
  "gpt-4o":                    { input: 2.50, output: 10,   cacheRead: 1.25,  cacheWrite: 2.50 },
  "gpt-4o-mini":               { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.15 },
  "o3":                        { input: 2,    output: 8,    cacheRead: 0.50,  cacheWrite: 2 },
  "o3-mini":                   { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 1.10 },
  "o4-mini":                   { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 1.10 },
  "codex-mini":                { input: 1.50, output: 6,    cacheRead: 0.375, cacheWrite: 1.50 },
  "gpt-5.3-codex":             { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 1.75 },
  "gpt-5.2":                   { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 1.75 },
  "gpt-5.2-codex":             { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 1.75 },
  // Google
  "gemini-2.5-pro":            { input: 1.25, output: 10,   cacheRead: 0.315, cacheWrite: 4.50 },
  "gemini-2.5-flash":          { input: 0.15, output: 0.60, cacheRead: 0.0375,cacheWrite: 0.15 },
  "gemini-2.0-flash":          { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
};

// Fallback pricing per tool for unknown models
const FALLBACK: Record<ToolName, ModelPricing> = {
  claude: { input: 3,    output: 15,  cacheRead: 0.30,  cacheWrite: 3.75 },
  codex:  { input: 1.50, output: 6,   cacheRead: 0.375, cacheWrite: 1.50 },
  gemini: { input: 1.25, output: 10,  cacheRead: 0.315, cacheWrite: 4.50 },
};

export function getModelPricing(model: string, tool: ToolName): ModelPricing {
  // Try exact match first
  if (PRICING[model]) return PRICING[model];
  // Try prefix match (handles versioned model names like claude-sonnet-4-20250514)
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) return pricing;
  }
  // Try substring match for codex models (e.g. "GPT-5.3-Codex-Spark")
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (lower.includes(key.toLowerCase())) return pricing;
  }
  return FALLBACK[tool];
}

// ── Quota Types (Usage tab) ─────────────────────────────────────────────────

export type ClaudeQuota = {
  session: { utilization: number; resetsAt: string | null };
  weekly: { utilization: number; resetsAt: string | null };
  weeklySonnet: { utilization: number; resetsAt: string | null } | null;
  extraUsage: { isEnabled: boolean; utilization: number | null };
  subscriptionType: string;
};

export type CodexQuota = {
  primary: { usedPercent: number; windowMinutes: number; resetsAt: number } | null;
  secondary: { usedPercent: number; windowMinutes: number; resetsAt: number } | null;
  planType: string | null;
  staleSeconds: number;
};

export type GeminiBucket = {
  modelId: string;
  remainingFraction: number;
  resetTime: string;
};

export type GeminiQuota = {
  buckets: GeminiBucket[];
  account: string | null;
};

export type QuotaData = {
  claude: ClaudeQuota | null;
  codex: CodexQuota | null;
  gemini: GeminiQuota | null;
  fetchedAt: Date;
  errors: { claude?: string; codex?: string; gemini?: string };
};

export function computeCost(entry: TokenEntry): number {
  const p = getModelPricing(entry.model, entry.tool);
  const M = 1_000_000;
  return (
    (entry.inputTokens * p.input) / M +
    (entry.outputTokens * p.output) / M +
    (entry.cacheReadTokens * p.cacheRead) / M +
    (entry.cacheWriteTokens * p.cacheWrite) / M
  );
}

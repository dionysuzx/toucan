import type { ScanResult } from "./scan";
import type { ToolName, ModelUsage, DayUsage, ToolSummary, QuotaData, ClaudeQuota, CodexQuota, GeminiQuota } from "./types";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const ESC = "\x1b[";

const c = {
  reset:   `${ESC}0m`,
  bold:    `${ESC}1m`,
  dim:     `${ESC}2m`,
  italic:  `${ESC}3m`,
  under:   `${ESC}4m`,
  // foreground
  black:   `${ESC}30m`,
  red:     `${ESC}31m`,
  green:   `${ESC}32m`,
  yellow:  `${ESC}33m`,
  blue:    `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan:    `${ESC}36m`,
  white:   `${ESC}37m`,
  gray:    `${ESC}90m`,
  // bright
  brightCyan:    `${ESC}96m`,
  brightGreen:   `${ESC}92m`,
  brightYellow:  `${ESC}93m`,
  brightWhite:   `${ESC}97m`,
  brightMagenta: `${ESC}95m`,
  // bg
  bgBlue:    `${ESC}44m`,
  bgCyan:    `${ESC}46m`,
  bgGreen:   `${ESC}42m`,
  bgYellow:  `${ESC}43m`,
  bgGray:    `${ESC}100m`,
};

const TOOL_COLOR: Record<ToolName, string> = {
  claude: c.brightCyan,
  codex:  c.brightGreen,
  gemini: c.brightYellow,
};

const TOOL_LABEL: Record<ToolName, string> = {
  claude: "Claude Code",
  codex:  "Codex CLI",
  gemini: "Gemini CLI",
};

const BAR_FULL = "█";
const BAR_EMPTY = "░";

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function fmtPct(pct: number): string {
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, len: number, align: "left" | "right" = "left"): string {
  // Strip ANSI codes for length calculation
  const diff = len - visibleLen(s);
  if (diff <= 0) return s;
  const spaces = " ".repeat(diff);
  return align === "right" ? spaces + s : s + spaces;
}

function bar(fraction: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, fraction || 0));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return BAR_FULL.repeat(filled) + `${c.dim}${BAR_EMPTY.repeat(empty)}${c.reset}`;
}

function hrule(width: number): string {
  return `${c.dim}${"─".repeat(width)}${c.reset}`;
}

// ── Views ────────────────────────────────────────────────────────────────────

type View = "overview" | "models" | "daily" | "stats" | "usage";
const VIEWS: View[] = ["daily", "usage", "overview", "models", "stats"];
const VIEW_LABELS: Record<View, string> = {
  overview: "Overview",
  models: "Models",
  daily: "Daily",
  stats: "Stats",
  usage: "Usage",
};

function renderTabs(active: View, width: number): string {
  let line = "  ";
  for (const v of VIEWS) {
    if (v === active) {
      line += `${c.bold}${c.bgGray}${c.brightWhite} ${VIEW_LABELS[v]} ${c.reset}  `;
    } else {
      line += `${c.dim}${VIEW_LABELS[v]}${c.reset}  `;
    }
  }
  return line;
}

function renderHeader(active: View, width: number): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${c.bold}${c.brightCyan}toucan${c.reset}${c.dim}  ·  AI token usage dashboard${c.reset}`);
  lines.push("");
  lines.push(renderTabs(active, width));
  lines.push(hrule(width - 2));
  return lines;
}

function fmtClock(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

type LiveStatus = {
  enabled: boolean;
  refreshMs: number;
  isRefreshing: boolean;
  lastUpdatedAt: Date | null;
  lastRefreshError: string | null;
};

function renderFooter(width: number, live: LiveStatus): string[] {
  const lines: string[] = [];
  lines.push(hrule(width - 2));
  const helpText = `  ${c.dim}tab${c.reset} switch view  ${c.dim}1-5${c.reset} jump to view  ${c.dim}r${c.reset} refresh  ${c.dim}q${c.reset} quit`;

  if (live.enabled) {
    const last = live.lastUpdatedAt ? fmtClock(live.lastUpdatedAt) : "never";
    const updated = `${c.dim}updated${c.reset} ${c.yellow}${last}${c.reset}`;
    const contentWidth = Math.max(0, width - 2);
    const gap = Math.max(2, contentWidth - visibleLen(helpText) - visibleLen(updated));
    lines.push(`${helpText}${" ".repeat(gap)}${updated}`);
  } else {
    lines.push(helpText);
  }

  if (live.enabled && live.lastRefreshError) {
    const msg = live.lastRefreshError.length > 90
      ? `${live.lastRefreshError.slice(0, 87)}...`
      : live.lastRefreshError;
    lines.push(`  ${c.red}refresh error: ${msg}${c.reset}`);
  }

  lines.push("");
  return lines;
}

// ── Overview View ────────────────────────────────────────────────────────────

function renderOverview(data: ScanResult, width: number): string[] {
  const lines: string[] = [];
  const tools = [data.claude, data.codex, data.gemini];
  const totalCost = tools.reduce((s, t) => s + t.totalCostUsd, 0);
  const totalIn = tools.reduce((s, t) => s + t.totalInputTokens, 0);
  const totalOut = tools.reduce((s, t) => s + t.totalOutputTokens, 0);
  const totalCache = tools.reduce((s, t) => s + t.totalCacheReadTokens + t.totalCacheWriteTokens, 0);
  const totalSessions = tools.reduce((s, t) => s + t.sessions, 0);
  const totalEntries = tools.reduce((s, t) => s + t.entries, 0);

  lines.push("");

  // Big numbers
  const costStr = totalCost >= 1 ? `$${totalCost.toFixed(2)}` : fmtCost(totalCost);
  lines.push(`  ${c.dim}Total Spend${c.reset}     ${c.bold}${c.brightWhite}${costStr}${c.reset}          ${c.dim}Input Tokens${c.reset}    ${c.brightWhite}${fmtTokens(totalIn)}${c.reset}`);
  lines.push(`  ${c.dim}Sessions${c.reset}        ${c.brightWhite}${fmtNum(totalSessions)}${c.reset}              ${c.dim}Output Tokens${c.reset}   ${c.brightWhite}${fmtTokens(totalOut)}${c.reset}`);
  lines.push(`  ${c.dim}API Calls${c.reset}       ${c.brightWhite}${fmtNum(totalEntries)}${c.reset}            ${c.dim}Cache Tokens${c.reset}    ${c.brightWhite}${fmtTokens(totalCache)}${c.reset}`);

  lines.push("");
  lines.push(`  ${c.bold}Per Tool${c.reset}`);
  lines.push(`  ${hrule(70)}`);

  // Tool table header
  lines.push(
    `  ${pad(`${c.dim}Tool${c.reset}`, 20)}${pad(`${c.dim}Cost${c.reset}`, 12)}${pad(`${c.dim}Tokens${c.reset}`, 12)}${pad(`${c.dim}Sessions${c.reset}`, 10)}`,
  );

  const barWidth = 30;
  for (const tool of tools) {
    if (tool.entries === 0) continue;
    const pct = totalCost > 0 ? tool.totalCostUsd / totalCost : 0;
    const totalTokens = tool.totalInputTokens + tool.totalOutputTokens;
    const color = TOOL_COLOR[tool.tool];

    lines.push(
      `  ${color}${pad(TOOL_LABEL[tool.tool], 18)}${c.reset}` +
      `${pad(fmtCost(tool.totalCostUsd), 10, "right")}  ` +
      `${pad(fmtTokens(totalTokens), 10, "right")}  ` +
      `${pad(String(tool.sessions), 8, "right")}`,
    );
    lines.push(
      `  ${" ".repeat(18)}${color}${bar(pct, barWidth)}${c.reset}  ${c.dim}${fmtPct(pct * 100)}${c.reset}`,
    );
  }

  // Top models
  const allModels = [...data.claude.models, ...data.codex.models, ...data.gemini.models]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 7);

  if (allModels.length > 0) {
    lines.push("");
    lines.push(`  ${c.bold}Top Models${c.reset}`);
    lines.push(`  ${hrule(70)}`);

    for (const m of allModels) {
      const pct = totalCost > 0 ? m.costUsd / totalCost : 0;
      const color = TOOL_COLOR[m.tool];
      lines.push(
        `  ${color}${pad(m.model, 30)}${c.reset}` +
        `${pad(fmtCost(m.costUsd), 10, "right")}  ` +
        `${color}${bar(pct, 20)}${c.reset}  ${c.dim}${fmtPct(pct * 100)}${c.reset}`,
      );
    }
  }

  return lines;
}

// ── Models View ──────────────────────────────────────────────────────────────

function renderModels(data: ScanResult, width: number): string[] {
  const lines: string[] = [];
  const allModels = [...data.claude.models, ...data.codex.models, ...data.gemini.models]
    .sort((a, b) => b.costUsd - a.costUsd);

  const totalCost = allModels.reduce((s, m) => s + m.costUsd, 0);

  lines.push("");
  lines.push(
    `  ${pad(`${c.dim}Model${c.reset}`, 32)}` +
    `${pad(`${c.dim}Tool${c.reset}`, 14)}` +
    `${pad(`${c.dim}Cost${c.reset}`, 10)}` +
    `${pad(`${c.dim}Input${c.reset}`, 10)}` +
    `${pad(`${c.dim}Output${c.reset}`, 10)}` +
    `${pad(`${c.dim}Cache R${c.reset}`, 10)}` +
    `${pad(`${c.dim}Calls${c.reset}`, 8)}`,
  );
  lines.push(`  ${hrule(90)}`);

  for (const m of allModels) {
    const color = TOOL_COLOR[m.tool];
    const pct = totalCost > 0 ? m.costUsd / totalCost : 0;

    lines.push(
      `  ${color}${pad(m.model, 30)}${c.reset}  ` +
      `${pad(TOOL_LABEL[m.tool], 12)}  ` +
      `${pad(fmtCost(m.costUsd), 8, "right")}  ` +
      `${pad(fmtTokens(m.inputTokens), 8, "right")}  ` +
      `${pad(fmtTokens(m.outputTokens), 8, "right")}  ` +
      `${pad(fmtTokens(m.cacheReadTokens), 8, "right")}  ` +
      `${pad(String(m.entries), 6, "right")}`,
    );
    lines.push(
      `  ${" ".repeat(30)}  ${" ".repeat(12)}  ${color}${bar(pct, 30)}${c.reset}  ${c.dim}${fmtPct(pct * 100)}${c.reset}`,
    );
  }

  if (allModels.length === 0) {
    lines.push(`  ${c.dim}No model data found.${c.reset}`);
  }

  return lines;
}

// ── Daily View ───────────────────────────────────────────────────────────────

function renderDaily(data: ScanResult, width: number): string[] {
  const lines: string[] = [];

  // Merge daily data across tools
  const dayMap = new Map<string, { cost: number; tokens: number; entries: number; byClaude: number; byCodex: number; byGemini: number }>();
  for (const tool of [data.claude, data.codex, data.gemini]) {
    for (const d of tool.daily) {
      let existing = dayMap.get(d.date);
      if (!existing) {
        existing = { cost: 0, tokens: 0, entries: 0, byClaude: 0, byCodex: 0, byGemini: 0 };
        dayMap.set(d.date, existing);
      }
      existing.cost += d.costUsd;
      existing.tokens += d.inputTokens + d.outputTokens + d.cacheTokens;
      existing.entries += d.entries;
      if (tool.tool === "claude") existing.byClaude += d.costUsd;
      if (tool.tool === "codex") existing.byCodex += d.costUsd;
      if (tool.tool === "gemini") existing.byGemini += d.costUsd;
    }
  }

  const days = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14); // Last 14 days

  if (days.length === 0) {
    lines.push("");
    lines.push(`  ${c.dim}No daily data found.${c.reset}`);
    return lines;
  }

  const maxCost = Math.max(...days.map(([, d]) => d.cost), 0.001);
  const barWidth = 40;

  lines.push("");
  lines.push(`  ${c.bold}Daily Spend${c.reset}  ${c.dim}(last ${days.length} days)${c.reset}`);
  lines.push("");

  // Legend
  lines.push(
    `  ${TOOL_COLOR.claude}█${c.reset} Claude  ` +
    `${TOOL_COLOR.codex}█${c.reset} Codex  ` +
    `${TOOL_COLOR.gemini}█${c.reset} Gemini`,
  );
  lines.push("");

  for (const [date, day] of days) {
    const shortDate = date.slice(5); // MM-DD
    const totalFrac = day.cost / maxCost;
    const claudeFrac = day.byClaude / maxCost;
    const codexFrac = day.byCodex / maxCost;
    const geminiFrac = day.byGemini / maxCost;

    const claudeBars = Math.round(claudeFrac * barWidth);
    const codexBars = Math.round(codexFrac * barWidth);
    const geminiBars = Math.round(geminiFrac * barWidth);
    const totalBars = claudeBars + codexBars + geminiBars;
    const emptyBars = Math.max(0, barWidth - totalBars);

    const barStr =
      `${TOOL_COLOR.claude}${BAR_FULL.repeat(claudeBars)}${c.reset}` +
      `${TOOL_COLOR.codex}${BAR_FULL.repeat(codexBars)}${c.reset}` +
      `${TOOL_COLOR.gemini}${BAR_FULL.repeat(geminiBars)}${c.reset}` +
      `${c.dim}${BAR_EMPTY.repeat(emptyBars)}${c.reset}`;

    lines.push(
      `  ${c.dim}${shortDate}${c.reset}  ${barStr}  ${pad(fmtCost(day.cost), 8, "right")}  ${c.dim}${fmtTokens(day.tokens)} tok${c.reset}`,
    );
  }

  // Summary row
  const totalCost = days.reduce((s, [, d]) => s + d.cost, 0);
  const avgCost = totalCost / days.length;
  lines.push("");
  lines.push(`  ${c.dim}Total: ${fmtCost(totalCost)}  ·  Avg/day: ${fmtCost(avgCost)}  ·  Peak: ${fmtCost(maxCost)}${c.reset}`);

  return lines;
}

// ── Stats View ───────────────────────────────────────────────────────────────

function renderStats(data: ScanResult, width: number): string[] {
  const lines: string[] = [];
  const tools = [data.claude, data.codex, data.gemini];
  const totalCost = tools.reduce((s, t) => s + t.totalCostUsd, 0);
  const totalSessions = tools.reduce((s, t) => s + t.sessions, 0);
  const totalEntries = tools.reduce((s, t) => s + t.entries, 0);
  const totalIn = tools.reduce((s, t) => s + t.totalInputTokens, 0);
  const totalOut = tools.reduce((s, t) => s + t.totalOutputTokens, 0);
  const totalCacheRead = tools.reduce((s, t) => s + t.totalCacheReadTokens, 0);
  const totalCacheWrite = tools.reduce((s, t) => s + t.totalCacheWriteTokens, 0);
  const totalReasoning = tools.reduce((s, t) => s + t.totalReasoningTokens, 0);

  lines.push("");
  lines.push(`  ${c.bold}Token Breakdown${c.reset}`);
  lines.push(`  ${hrule(50)}`);

  const tokenTotal = totalIn + totalOut + totalCacheRead + totalCacheWrite + totalReasoning;
  const cats: [string, number, string][] = [
    ["Input", totalIn, c.brightWhite],
    ["Output", totalOut, c.brightMagenta],
    ["Cache Read", totalCacheRead, c.brightCyan],
    ["Cache Write", totalCacheWrite, c.cyan],
    ["Reasoning", totalReasoning, c.brightYellow],
  ];

  for (const [label, count, color] of cats) {
    const pct = tokenTotal > 0 ? count / tokenTotal : 0;
    lines.push(
      `  ${pad(label, 14)}  ${color}${pad(fmtTokens(count), 8, "right")}${c.reset}  ` +
      `${color}${bar(pct, 20)}${c.reset}  ${c.dim}${fmtPct(pct * 100)}${c.reset}`,
    );
  }

  // Cache efficiency
  const cacheHitRate = (totalIn + totalCacheRead) > 0
    ? totalCacheRead / (totalIn + totalCacheRead)
    : 0;

  lines.push("");
  lines.push(`  ${c.bold}Cache Efficiency${c.reset}`);
  lines.push(`  ${hrule(50)}`);
  lines.push(`  ${c.dim}Cache Hit Rate${c.reset}   ${c.brightCyan}${fmtPct(cacheHitRate * 100)}${c.reset}  ${c.dim}(${fmtTokens(totalCacheRead)} of ${fmtTokens(totalIn + totalCacheRead)} input)${c.reset}`);
  lines.push(`  ${c.dim}Cache Volume${c.reset}     ${c.brightCyan}${fmtTokens(totalCacheRead + totalCacheWrite)}${c.reset}  ${c.dim}tokens (read + write)${c.reset}`);

  // Per-session averages
  lines.push("");
  lines.push(`  ${c.bold}Averages${c.reset}`);
  lines.push(`  ${hrule(50)}`);

  if (totalSessions > 0) {
    lines.push(`  ${c.dim}Cost / Session${c.reset}     ${fmtCost(totalCost / totalSessions)}`);
    lines.push(`  ${c.dim}Tokens / Session${c.reset}   ${fmtTokens(Math.round((totalIn + totalOut) / totalSessions))}`);
    lines.push(`  ${c.dim}Calls / Session${c.reset}   ${(totalEntries / totalSessions).toFixed(1)}`);
  }

  // Per-tool stats
  lines.push("");
  lines.push(`  ${c.bold}Per Tool${c.reset}`);
  lines.push(`  ${hrule(50)}`);
  lines.push(
    `  ${pad(`${c.dim}Tool${c.reset}`, 18)}` +
    `${pad(`${c.dim}$/Session${c.reset}`, 12)}` +
    `${pad(`${c.dim}Tok/Call${c.reset}`, 12)}` +
    `${pad(`${c.dim}Cache %${c.reset}`, 10)}`,
  );

  for (const tool of tools) {
    if (tool.entries === 0) continue;
    const color = TOOL_COLOR[tool.tool];
    const costPerSession = tool.sessions > 0 ? tool.totalCostUsd / tool.sessions : 0;
    const tokPerCall = tool.entries > 0
      ? Math.round((tool.totalInputTokens + tool.totalOutputTokens) / tool.entries)
      : 0;
    const cacheRate = (tool.totalInputTokens + tool.totalCacheReadTokens) > 0
      ? tool.totalCacheReadTokens / (tool.totalInputTokens + tool.totalCacheReadTokens)
      : 0;

    lines.push(
      `  ${color}${pad(TOOL_LABEL[tool.tool], 16)}${c.reset}  ` +
      `${pad(fmtCost(costPerSession), 10, "right")}  ` +
      `${pad(fmtTokens(tokPerCall), 10, "right")}  ` +
      `${pad(fmtPct(cacheRate * 100), 8, "right")}`,
    );
  }

  return lines;
}

// Exported for testing
export { bar, fmtCost, fmtTokens, fmtPct, fmtTimeDiff, visibleLen, pad, renderUsage };
export { fmtUnixReset, fmtResetTime, fmtResetDate };

// ── Usage View ──────────────────────────────────────────────────────────────

function fmtResetTime(isoStr: string | null): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return fmt.format(d);
}

function fmtResetDate(isoStr: string | null): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return fmt.format(d);
}

function fmtUnixReset(ts: number): string {
  if (!ts) return "";
  // Heuristic: if > 1e12, value is already in milliseconds
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return hh + ":" + mm;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${hh}:${mm} on ${d.getDate()} ${months[d.getMonth()]}`;
}

function fmtTimeDiff(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function renderUsage(quota: QuotaData | null, width: number): string[] {
  const lines: string[] = [];
  const BWIDTH = 50;

  if (!quota) {
    lines.push("");
    lines.push(`  ${c.dim}Fetching quota data...${c.reset}`);
    return lines;
  }

  // ── Claude Code Section ──────────────────────────────────────────────────
  lines.push("");
  const claudeLabel = quota.claude
    ? `Claude Code (${quota.claude.subscriptionType.charAt(0).toUpperCase() + quota.claude.subscriptionType.slice(1)})`
    : "Claude Code";
  lines.push(`  ${c.brightCyan}${c.bold}${claudeLabel}${c.reset}`);
  lines.push(`  ${c.brightCyan}${hrule(BWIDTH + 4)}${c.reset}`);

  if (quota.errors.claude) {
    lines.push(`  ${c.dim}Could not fetch quota: ${quota.errors.claude}${c.reset}`);
  } else if (quota.claude) {
    const q = quota.claude;

    // Session
    lines.push("");
    lines.push(`  ${c.dim}Current session${c.reset}`);
    const sessPct = Math.round(q.session.utilization);
    lines.push(`  ${c.brightCyan}${bar(q.session.utilization / 100, BWIDTH)}${c.reset}   ${sessPct}% used`);
    if (q.session.resetsAt) {
      lines.push(`  ${c.dim}Resets ${fmtResetTime(q.session.resetsAt)}${c.reset}`);
    }

    // Weekly (all models)
    lines.push("");
    lines.push(`  ${c.dim}Current week (all models)${c.reset}`);
    const weekPct = Math.round(q.weekly.utilization);
    lines.push(`  ${c.brightCyan}${bar(q.weekly.utilization / 100, BWIDTH)}${c.reset}   ${weekPct}% used`);
    if (q.weekly.resetsAt) {
      lines.push(`  ${c.dim}Resets ${fmtResetDate(q.weekly.resetsAt)}${c.reset}`);
    }

    // Weekly Sonnet
    if (q.weeklySonnet) {
      lines.push("");
      lines.push(`  ${c.dim}Current week (Sonnet only)${c.reset}`);
      const sonPct = Math.round(q.weeklySonnet.utilization);
      lines.push(`  ${c.brightCyan}${bar(q.weeklySonnet.utilization / 100, BWIDTH)}${c.reset}   ${sonPct}% used`);
      if (q.weeklySonnet.resetsAt) {
        lines.push(`  ${c.dim}Resets ${fmtResetDate(q.weeklySonnet.resetsAt)}${c.reset}`);
      }
    }

    // Extra usage (only show when enabled)
    if (q.extraUsage.isEnabled) {
      lines.push("");
      lines.push(`  ${c.dim}Extra usage${c.reset}`);
      const extraPct = q.extraUsage.utilization != null ? Math.round(q.extraUsage.utilization) : 0;
      lines.push(`  ${c.brightCyan}${bar((q.extraUsage.utilization ?? 0) / 100, BWIDTH)}${c.reset}   ${extraPct}% used`);
    }
  }

  // ── Codex CLI Section ────────────────────────────────────────────────────
  lines.push("");
  lines.push("");
  const codexLabel = quota.codex?.planType
    ? `Codex CLI (${quota.codex.planType.charAt(0).toUpperCase() + quota.codex.planType.slice(1)})`
    : "Codex CLI";
  lines.push(`  ${c.brightGreen}${c.bold}${codexLabel}${c.reset}`);
  lines.push(`  ${c.brightGreen}${hrule(BWIDTH + 4)}${c.reset}`);

  if (quota.errors.codex) {
    lines.push(`  ${c.dim}Could not fetch quota: ${quota.errors.codex}${c.reset}`);
  } else if (quota.codex) {
    const q = quota.codex;
    const CBAR = 20;

    if (q.primary || q.secondary) {
      lines.push("");

      if (q.primary) {
        const leftPct = Math.max(0, 100 - q.primary.usedPercent);
        const leftFrac = leftPct / 100;
        const filled = Math.round(leftFrac * CBAR);
        const empty = CBAR - filled;
        const barStr = `[${c.brightGreen}${BAR_FULL.repeat(filled)}${c.dim}${BAR_EMPTY.repeat(empty)}${c.reset}]`;
        const resetStr = fmtUnixReset(q.primary.resetsAt);
        lines.push(`  5h limit:      ${barStr} ${Math.round(leftPct)}% left${resetStr ? ` (resets ${resetStr})` : ""}`);
      }

      if (q.secondary) {
        const leftPct = Math.max(0, 100 - q.secondary.usedPercent);
        const leftFrac = leftPct / 100;
        const filled = Math.round(leftFrac * CBAR);
        const empty = CBAR - filled;
        const barStr = `[${c.brightGreen}${BAR_FULL.repeat(filled)}${c.dim}${BAR_EMPTY.repeat(empty)}${c.reset}]`;
        const resetStr = fmtUnixReset(q.secondary.resetsAt);
        lines.push(`  Weekly limit:  ${barStr} ${Math.round(leftPct)}% left${resetStr ? ` (resets ${resetStr})` : ""}`);
      }

      if (q.staleSeconds > 900) {
        const mins = Math.round(q.staleSeconds / 60);
        lines.push(`  ${c.dim}(data from ${mins} min ago)${c.reset}`);
      }
    } else {
      lines.push(`  ${c.dim}No rate limit data in recent session${c.reset}`);
    }
  }

  // ── Gemini CLI Section ───────────────────────────────────────────────────
  lines.push("");
  lines.push("");
  const geminiLabel = quota.gemini?.account
    ? `Gemini CLI (${quota.gemini.account})`
    : "Gemini CLI";
  lines.push(`  ${c.brightYellow}${c.bold}${geminiLabel}${c.reset}`);
  lines.push(`  ${c.brightYellow}${hrule(BWIDTH + 4)}${c.reset}`);

  if (quota.errors.gemini) {
    lines.push(`  ${c.dim}Could not fetch quota: ${quota.errors.gemini}${c.reset}`);
  } else if (quota.gemini) {
    const q = quota.gemini;
    if (q.buckets.length > 0) {
      lines.push("");

      for (const b of q.buckets) {
        const pct = (b.remainingFraction * 100).toFixed(1);
        const resetStr = b.resetTime ? `resets in ${fmtTimeDiff(b.resetTime)}` : "";
        lines.push(
          `  ${c.brightYellow}${pad(b.modelId, 34)}${c.reset}` +
          `${pad(pct + "%", 7, "right")} ${c.dim}${resetStr}${c.reset}`,
        );
      }
    } else {
      lines.push(`  ${c.dim}No quota buckets returned${c.reset}`);
    }
  }

  return lines;
}

// ── TUI Engine ───────────────────────────────────────────────────────────────

export type TuiOptions = {
  refreshMs?: number;
  fetchLatest?: () => Promise<ScanResult>;
  initialQuotas?: QuotaData | null;
  fetchQuotas?: () => Promise<QuotaData>;
};

export function startTui(initialData: ScanResult, opts: TuiOptions = {}): void {
  let data = initialData;
  let quotaData: QuotaData | null = opts.initialQuotas ?? null;
  let currentView: View = "daily";
  let termWidth = process.stdout.columns || 100;
  const refreshMs = Math.max(1000, opts.refreshMs ?? 5000);
  const liveEnabled = typeof opts.fetchLatest === "function";
  let isRefreshing = false;
  let lastUpdatedAt: Date | null = new Date();
  let lastRefreshError: string | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;

  function render() {
    if (isClosed) return;
    const header = renderHeader(currentView, termWidth);
    let body: string[];

    switch (currentView) {
      case "overview":
        body = renderOverview(data, termWidth);
        break;
      case "models":
        body = renderModels(data, termWidth);
        break;
      case "daily":
        body = renderDaily(data, termWidth);
        break;
      case "stats":
        body = renderStats(data, termWidth);
        break;
      case "usage":
        body = renderUsage(quotaData, termWidth);
        break;
    }

    const footer = renderFooter(termWidth, {
      enabled: liveEnabled,
      refreshMs,
      isRefreshing,
      lastUpdatedAt,
      lastRefreshError,
    });

    const termHeight = process.stdout.rows || 24;
    const contentLines = [...header, ...body, ""];
    const totalUsed = contentLines.length + footer.length;
    const padLines = Math.max(0, termHeight - totalUsed);
    const output = [...contentLines, ...Array(padLines).fill(""), ...footer].join("\n");

    process.stdout.write(`\x1b[2J\x1b[H${output}`);
  }

  async function refreshData(): Promise<void> {
    if (isRefreshing || isClosed) return;
    if (!opts.fetchLatest && !opts.fetchQuotas) return;

    isRefreshing = true;
    render();
    try {
      const promises: Promise<any>[] = [];
      if (opts.fetchLatest) promises.push(opts.fetchLatest());
      if (opts.fetchQuotas) promises.push(opts.fetchQuotas());

      const results = await Promise.allSettled(promises);
      if (isClosed) return;

      let idx = 0;
      const errors: string[] = [];
      if (opts.fetchLatest) {
        if (results[idx].status === "fulfilled") {
          data = (results[idx] as PromiseFulfilledResult<ScanResult>).value;
        } else {
          errors.push((results[idx] as PromiseRejectedResult).reason?.message ?? "scan refresh failed");
        }
        idx++;
      }
      if (opts.fetchQuotas) {
        if (results[idx].status === "fulfilled") {
          quotaData = (results[idx] as PromiseFulfilledResult<QuotaData>).value;
        } else {
          errors.push((results[idx] as PromiseRejectedResult).reason?.message ?? "quota refresh failed");
        }
      }

      lastUpdatedAt = new Date();
      lastRefreshError = errors.length > 0 ? errors.join("; ") : null;
    } catch (err) {
      if (isClosed) return;
      if (err instanceof Error) {
        lastRefreshError = err.message;
      } else {
        lastRefreshError = String(err);
      }
    } finally {
      isRefreshing = false;
      render();
    }
  }

  // Input handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Hide cursor
  process.stdout.write("\x1b[?25l");

  function cleanup() {
    if (isClosed) return;
    isClosed = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    process.stdout.write("\x1b[?25h"); // Show cursor
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("exit", cleanup);

  process.stdout.on("resize", () => {
    termWidth = process.stdout.columns || 100;
    render();
  });

  process.stdin.on("data", (key: string) => {
    // Ctrl+C or q
    if (key === "\x03" || key === "q" || key === "Q") {
      cleanup();
      process.exit(0);
    }

    // Tab — cycle views
    if (key === "\t") {
      const idx = VIEWS.indexOf(currentView);
      currentView = VIEWS[(idx + 1) % VIEWS.length];
      render();
      return;
    }

    // Shift+Tab — cycle views backward
    if (key === "\x1b[Z") {
      const idx = VIEWS.indexOf(currentView);
      currentView = VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length];
      render();
      return;
    }

    // Number keys 1-5
    const num = parseInt(key, 10);
    if (num >= 1 && num <= VIEWS.length) {
      currentView = VIEWS[num - 1];
      render();
      return;
    }

    // Manual refresh
    if (key === "r" || key === "R") {
      void refreshData();
      return;
    }
  });

  if (liveEnabled) {
    refreshTimer = setInterval(() => {
      void refreshData();
    }, refreshMs);
  }

  render();
}

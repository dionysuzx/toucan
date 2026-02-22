import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ClaudeQuota, CodexQuota, GeminiBucket, GeminiQuota, QuotaData } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readJson(path: string): Promise<any> {
  const content = await readFile(path, "utf8");
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${(e as Error).message}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ── Claude Code Quota ────────────────────────────────────────────────────────
// Reads OAuth token from ~/.claude/.credentials.json
// Calls GET https://api.anthropic.com/api/oauth/usage

async function fetchClaudeQuota(): Promise<ClaudeQuota> {
  const credPath = join(homedir(), ".claude", ".credentials.json");
  const creds = await readJson(credPath);

  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) throw new Error("No Claude OAuth token found");

  const subscriptionType = creds?.claudeAiOauth?.subscriptionType ?? "unknown";

  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }

  const data = await res.json() as any;

  const mapBucket = (b: any) => ({
    utilization: b?.utilization ?? 0,
    resetsAt: b?.resets_at ?? null,
  });

  return {
    session: mapBucket(data.five_hour),
    weekly: mapBucket(data.seven_day),
    weeklySonnet: data.seven_day_sonnet ? mapBucket(data.seven_day_sonnet) : null,
    extraUsage: {
      isEnabled: data.extra_usage?.is_enabled ?? false,
      utilization: data.extra_usage?.utilization ?? null,
    },
    subscriptionType,
  };
}

// ── Codex CLI Quota ──────────────────────────────────────────────────────────
// Parses rate_limits from the most recent session JSONL in ~/.codex/sessions/

async function fetchCodexQuota(): Promise<CodexQuota> {
  const base = join(homedir(), ".codex", "sessions");
  if (!(await exists(base))) throw new Error("No Codex sessions directory");

  // Walk year/month/day structure to find the most recent .jsonl
  const latestFile = await findLatestCodexSession(base);
  if (!latestFile) throw new Error("No Codex session files found");

  const content = await readFile(latestFile, "utf8");
  const fileStat = await stat(latestFile);
  const staleSeconds = Math.round((Date.now() - fileStat.mtimeMs) / 1000);

  // Find the last rate_limits entry and session_meta for plan type
  let lastRateLimits: any = null;
  let planType: string | null = null;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === "session_meta" && obj.payload?.plan_type) {
      planType = obj.payload.plan_type;
    }

    if (obj.type === "event_msg" && obj.payload?.rate_limits) {
      lastRateLimits = obj.payload.rate_limits;
    }
  }

  if (!lastRateLimits) {
    return { primary: null, secondary: null, planType, staleSeconds };
  }

  const mapLimit = (bucket: any) => {
    if (!bucket) return null;
    return {
      usedPercent: bucket.used_percent ?? 0,
      windowMinutes: bucket.window_minutes ?? 0,
      resetsAt: bucket.resets_at ?? 0,
    };
  };

  return {
    primary: mapLimit(lastRateLimits.primary),
    secondary: mapLimit(lastRateLimits.secondary),
    planType,
    staleSeconds,
  };
}

async function findLatestCodexSession(base: string): Promise<string | null> {
  // Walk the YYYY/MM/DD directory structure in reverse to find latest
  let years: string[];
  try {
    years = (await readdir(base)).filter(d => /^\d+$/.test(d)).sort().reverse();
  } catch {
    return null;
  }

  for (const year of years) {
    const yearPath = join(base, year);
    let months: string[];
    try {
      months = (await readdir(yearPath)).filter(d => /^\d+$/.test(d)).sort().reverse();
    } catch {
      continue;
    }

    for (const month of months) {
      const monthPath = join(yearPath, month);
      let days: string[];
      try {
        days = (await readdir(monthPath)).filter(d => /^\d+$/.test(d)).sort().reverse();
      } catch {
        continue;
      }

      for (const day of days) {
        const dayPath = join(monthPath, day);
        let files: string[];
        try {
          files = (await readdir(dayPath)).filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }

        if (files.length > 0) {
          // Pick the most recently modified file, not alphabetically last
          const withMtime = await Promise.all(
            files.map(async (f) => {
              const fp = join(dayPath, f);
              const s = await stat(fp);
              return { path: fp, mtimeMs: s.mtimeMs };
            }),
          );
          withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
          return withMtime[0].path;
        }
      }
    }
  }

  return null;
}

// ── Gemini CLI Quota ─────────────────────────────────────────────────────────
// Uses Google OAuth token from ~/.gemini/oauth_creds.json
// Calls retrieveUserQuota endpoint

// Public installed-app OAuth credentials from the Gemini CLI source.
// These identify the app, not the user — same values shipped in Google's
// open-source Gemini CLI. Override via env vars if needed.
const GEMINI_CLIENT_ID = process.env.GEMINI_CLIENT_ID
  ?? "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLIENT_SECRET = process.env.GEMINI_CLIENT_SECRET
  ?? "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";

async function refreshGeminiToken(creds: any): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json() as any;
  const newToken = data.access_token;
  if (!newToken) throw new Error("Token refresh did not return an access_token");
  const newExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;

  // Write refreshed token back (include rotated refresh_token if present)
  const credPath = join(homedir(), ".gemini", "oauth_creds.json");
  const updated = {
    ...creds,
    access_token: newToken,
    expiry_date: newExpiry,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
  };
  await writeFile(credPath, JSON.stringify(updated, null, 2));

  return newToken;
}

function parseGeminiBuckets(rawBuckets: any[]): GeminiBucket[] {
  return (rawBuckets ?? [])
    .filter((b: any) => b.modelId && b.remainingFraction != null && !b.modelId.endsWith("_vertex"))
    .map((b: any) => ({
      modelId: b.modelId,
      remainingFraction: b.remainingFraction,
      resetTime: b.resetTime ?? "",
    }));
}

async function fetchGeminiQuota(): Promise<GeminiQuota> {
  const credPath = join(homedir(), ".gemini", "oauth_creds.json");
  const creds = await readJson(credPath);

  if (!creds?.access_token) throw new Error("No Gemini OAuth token found");

  let accessToken = creds.access_token;

  // Refresh token if expired
  if (creds.expiry_date && Number(creds.expiry_date) < Date.now()) {
    if (!creds.refresh_token) throw new Error("No refresh token available");
    accessToken = await refreshGeminiToken(creds);
  }

  const authHeaders = { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" };

  // Step 1: Get projectId via loadCodeAssist
  const loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    }),
  });

  if (!loadRes.ok) {
    throw new Error(`loadCodeAssist ${loadRes.status}: ${await loadRes.text().catch(() => loadRes.statusText)}`);
  }

  const loadData = await loadRes.json() as any;
  const projectId = loadData.cloudaicompanionProject;
  if (!projectId) throw new Error("No projectId from loadCodeAssist");

  // Step 2: Retrieve user quota
  const quotaRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ project: projectId }),
  });

  if (!quotaRes.ok) {
    throw new Error(`retrieveUserQuota ${quotaRes.status}: ${await quotaRes.text().catch(() => quotaRes.statusText)}`);
  }

  const quotaData = await quotaRes.json() as any;
  const buckets = parseGeminiBuckets(quotaData.buckets);

  // Read account email
  let account: string | null = null;
  try {
    const accountsPath = join(homedir(), ".gemini", "google_accounts.json");
    const accounts = await readJson(accountsPath);
    if (Array.isArray(accounts) && accounts.length > 0) {
      account = accounts[0]?.email ?? accounts[0]?.account ?? null;
    } else if (accounts?.email) {
      account = accounts.email;
    }
  } catch {
    // Not critical
  }

  return { buckets, account };
}

// ── Exported for testing ─────────────────────────────────────────────────
export { parseGeminiBuckets };

// ── Public API ───────────────────────────────────────────────────────────────

export async function fetchAllQuotas(): Promise<QuotaData> {
  const results = await Promise.allSettled([
    fetchClaudeQuota(),
    fetchCodexQuota(),
    fetchGeminiQuota(),
  ]);

  const errors: QuotaData["errors"] = {};

  const claude = results[0].status === "fulfilled" ? results[0].value : null;
  if (results[0].status === "rejected") errors.claude = String(results[0].reason?.message ?? results[0].reason);

  const codex = results[1].status === "fulfilled" ? results[1].value : null;
  if (results[1].status === "rejected") errors.codex = String(results[1].reason?.message ?? results[1].reason);

  const gemini = results[2].status === "fulfilled" ? results[2].value : null;
  if (results[2].status === "rejected") errors.gemini = String(results[2].reason?.message ?? results[2].reason);

  return { claude, codex, gemini, fetchedAt: new Date(), errors };
}

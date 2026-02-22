#!/usr/bin/env bun

import { scanAll } from "./scan";
import { startTui } from "./tui";
import { fetchAllQuotas } from "./quota";

const LIVE_REFRESH_MS = 5000;

async function main() {
  const write = (msg: string) => process.stderr.write(`${msg}\n`);

  write("\x1b[36mtoucan\x1b[0m  scanning local AI tool data...\n");

  // Fetch scan data and quotas in parallel
  const [data, quotas] = await Promise.all([
    scanAll((msg) => write(`  \x1b[90m${msg}\x1b[0m`)),
    fetchAllQuotas().catch(() => null),
  ]);

  const totalEntries = data.claude.entries + data.codex.entries + data.gemini.entries;

  if (totalEntries === 0) {
    write("\n  No token usage data found.");
    write("  Looked in: ~/.claude/projects/  ~/.codex/sessions/  ~/.gemini/tmp/\n");
    process.exit(0);
  }

  write("");

  // Interactive TUI mode
  startTui(data, {
    refreshMs: LIVE_REFRESH_MS,
    fetchLatest: () => scanAll(),
    initialQuotas: quotas,
    fetchQuotas: fetchAllQuotas,
  });
}

main().catch((err) => {
  console.error("toucan error:", err);
  process.exit(1);
});

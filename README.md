# toucan

TUI dashboard for AI token usage. Scans local data from **Claude Code**, **Codex CLI**, and **Gemini CLI** to show costs, token breakdowns, and live quota information.

![Views: Daily spend, Usage quotas, Overview, Models, Stats]

## Install

```bash
git clone https://github.com/dionysuzx/toucan.git
cd toucan
bun install
bun link
```

After `bun link`, the `toucan` command is available globally:

```bash
toucan
```

## Development

```bash
git clone https://github.com/dionysuzx/toucan.git
cd toucan
bun install
bun run dev
```

`bun run dev` starts the TUI with live reload — edit any file and it restarts automatically.

## What it reads

Toucan scans these local directories (read-only, nothing is written or sent anywhere):

| Tool | Path |
|------|------|
| Claude Code | `~/.claude/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Gemini CLI | `~/.gemini/tmp/` |

Live quota data is fetched using existing OAuth tokens from each tool's local config.

All three tools' quotas work out of the box with no extra config.

## Views

Navigate with `Tab` or `1`-`5`:

1. **Daily** — last 14 days of spend with stacked bar charts per tool
2. **Usage** — live rate limit / quota status for all three tools
3. **Overview** — total spend, top models, per-tool breakdown
4. **Models** — detailed table of all models sorted by cost
5. **Stats** — token breakdown, cache efficiency, per-tool averages

Press `r` to refresh, `q` to quit.

## Customizing

Toucan is intentionally minimal — it's designed to be forked and built on. Add new models, tweak pricing, change the UI, add new tools.

Run `bun run dev` and edit the codebase with your favorite LLM coding tool. Live reload means you see changes instantly. Key files:

- `src/types.ts` — model pricing table
- `src/scan.ts` — data parsers for each tool
- `src/tui.ts` — all the UI rendering
- `src/quota.ts` — live quota fetching

## Tests

```bash
bun test
```

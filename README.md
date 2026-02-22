# toucan

<p align="center">
  <img src="toucan.jpeg" width="200" alt="toucan" />
</p>

Local-first token usage dashboard.

## Development (recommended)

Toucan is intentionally minimal — it's designed to be forked and built on. Add new models, tweak pricing, change the UI, add new tools.

```bash
git clone https://github.com/dionysuzx/toucan.git
cd toucan
bun install
bun run dev
```

`bun run dev` starts the TUI with live reload — edit toucan with your favorite LLM and it restarts automatically.

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

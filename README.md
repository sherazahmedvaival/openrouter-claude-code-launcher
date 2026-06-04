# OpenRouter Claude Code Launcher (`orcc`)

> An interactive, cross-platform CLI that browses [OpenRouter](https://openrouter.ai)
> models (free **and** paid) and launches [Claude Code](https://github.com/anthropics/claude-code)
> against the one you pick — with **zero global config** and **per-launch credential injection**.

![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Why this exists

OpenRouter exposes an **Anthropic-compatible** endpoint, so Claude Code can talk to it
natively — no local proxy required. The usual setup, though, means exporting
`ANTHROPIC_*` variables into your shell or a repo file, which makes the model + key
**global and static** and pollutes every other `claude` invocation.

`orcc` takes a cleaner approach: it spawns `claude` as a child process and injects the
OpenRouter configuration **into that process only**. Every launch is independent, you
pick a fresh model each time, and nothing leaks into your shell or your repo.

## Features

- 🔎 **Full catalog** — fetches every model from OpenRouter's public API (no key needed just to browse).
- 🆓💲 **Free / Paid first** — choose a category up front, then browse just that list.
- ⌨️ **Searchable picker** — type to fuzzy-filter hundreds of models; arrow keys to navigate.
- 💸 **Cheapest-first** — paid models are sorted by price ascending; `⭐` marks Anthropic (recommended for Claude Code).
- 🛠️ **Tool-capable only** — hides models that lack `tools` support (Claude Code is tool-use driven and won't work without it).
- 🧹 **Clean pricing** — filters out sentinel/invalid-price entries (e.g. `openrouter/auto`).
- 🚀 **Per-launch env injection** — never touches your global shell or repo files.
- 🧠 **Smart model roles** — your pick drives the main + subagent models; the cheap background/"fast" role uses a compatible cheap model (never a quota-capped free one).
- 🔐 **Safe credentials** — `OPENROUTER_API_KEY` → saved config (`chmod 600`) → prompt once.
- ⚡ **Cached + resilient** — short-lived model-list cache with stale-fallback on network failure.
- 🧯 **Robust errors** — clear handling for missing key, network failure, missing `claude` binary, and empty model lists; passes Claude Code's exit code through.
- 🪟🍎🐧 **Cross-platform** — macOS, Linux, and Windows.
- 🧰 **Scriptable** — non-interactive flags (`--model`, `--list`, `--refresh`).

## How it works

`orcc` spawns Claude Code with these variables set **for that process only**:

```
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=<your OpenRouter key>
ANTHROPIC_API_KEY=                         # explicitly empty (required by OpenRouter)
ANTHROPIC_DEFAULT_OPUS_MODEL   = <picked model>
ANTHROPIC_DEFAULT_SONNET_MODEL = <picked model>
CLAUDE_CODE_SUBAGENT_MODEL     = <picked model>
ANTHROPIC_DEFAULT_HAIKU_MODEL  = <cheap compatible model>   # background / "fast" role
ANTHROPIC_SMALL_FAST_MODEL     = <cheap compatible model>
```

The chosen model is also passed via `claude --model <id>`. The background/"fast" role is
**never** routed to a free model (those are quota-capped and unreliable) — for an Anthropic
main model it uses the cheapest Anthropic *haiku*, otherwise it reuses your picked model.

## Prerequisites

- **Node.js ≥ 18**
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`
- An **OpenRouter API key** — https://openrouter.ai/keys

## Installation

```bash
git clone git@github.com:sherazahmedvaival/openrouter-claude-code-launcher.git
cd openrouter-claude-code-launcher
npm install
```

Then either link it onto your `PATH`:

```bash
npm link        # now `orcc` is available anywhere
orcc
```

…or run it directly without linking:

```bash
node bin/orcc.js
```

## Usage

```bash
orcc                       # browse models, pick one, launch Claude Code
orcc --list                # print free + paid (tool-capable) models and exit
orcc --refresh             # ignore the ~10 min cache and re-fetch the catalog
orcc -m anthropic/claude-haiku-4.5            # skip the picker, launch this model
orcc -- --dangerously-skip-permissions        # forward args after -- to claude
```

### Interactive flow

Running `orcc` with no flags:

1. Asks **Free or Paid** — then shows only that category.
2. Opens a **searchable list** (type to filter, ↑/↓ to browse, `↩ Back` to switch
   category). **Paid is sorted cheapest-first**; `⭐` marks Anthropic (recommended).
3. A free selection prints a one-line reliability warning (non-blocking) and proceeds.
4. Prompts for your API key if one isn't already configured, then launches Claude Code.

## Credentials

`orcc` resolves your OpenRouter key in this order:

1. `OPENROUTER_API_KEY` environment variable
2. Saved config file
3. Interactive prompt (optionally saved for next time)

The config lives at `~/.config/orcc/config.json` (POSIX, written `chmod 600`) or
`%APPDATA%\orcc\config.json` (Windows). It also stores the short-lived model-list cache.

## Choosing a model

> **For a reliable Claude Code session, pick an Anthropic model (`⭐`).** OpenRouter only
> *guarantees* Claude Code with Anthropic first-party models. `orcc` lists everything, but:
>
> - **Free models** are rate-limited (~50 requests/day under $10 credit) and each is served
>   by a single sponsor provider. Claude Code makes many calls per prompt, so free models
>   commonly hit `429 · Provider returned error` mid-session.
> - **Cheap non-Anthropic models** often accept simple requests but **reject Claude Code's
>   full payload** (system prompt + tool definitions) with `422`, or return empty/garbled output.
>
> `anthropic/claude-haiku-4.5` is the cheapest reliable option; `anthropic/claude-sonnet-4.6`
> for stronger results. Sustained use needs real OpenRouter credit ($10+).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Retrying… 10/10`, "attempted to connect to server" | Free-model quota / provider throttling (`429`) | Use a paid Anthropic model; add OpenRouter credit |
| `API Error: 422 Provider returned error` | A non-Anthropic model rejected Claude Code's full request | Switch to an Anthropic model (`⭐`) |
| Empty / no response but exit 0 | Non-Anthropic model output doesn't map to Claude Code's format | Use an Anthropic model |
| `` `claude` was not found `` | Claude Code isn't installed / on `PATH` | `npm install -g @anthropic-ai/claude-code` |
| `Failed to load models` | Network/API issue | Re-run; `orcc` falls back to cached list when possible |

## How free vs paid is decided

A model is **free** only when both its `prompt` and `completion` prices are `0` on
OpenRouter (these IDs usually end in `:free`). Everything else is **paid** and billed to
your OpenRouter account. Only **tool-capable** models are listed in either group.

## License

MIT

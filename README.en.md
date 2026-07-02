# Bennira

> A Chinese-first, resumable, observable local coding agent CLI.

[![CI](https://github.com/BreetyGreen/Bennira/actions/workflows/ci.yml/badge.svg)](https://github.com/BreetyGreen/Bennira/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
![Zero deps](https://img.shields.io/badge/dependencies-0-blue.svg)

**中文** → [README.md](./README.md)

Bennira is an exploratory local coding agent. Its direction is similar to Codex / Claude Code: enter a codebase, understand its structure, hold a continuous conversation with you, call tools, make small edits, run commands, and close the loop through an event log and handoff docs.

Its differentiation is not cloning existing tools, but **turning a vague idea (expressed in Chinese) into a resumable, continuable, incrementally executable project state**.

Version lines are named after the job system of *Octopath Traveler* — the current one is **Thief**, symbolizing an early stage that borrows liberally and stays nimble.

---

## Features

- 🗣️ **Interactive REPL** — type `bennira` to enter a persistent session with continuous dialogue and accumulating context.
- 🌊 **Streaming output** — connects to OpenAI-compatible APIs (e.g. DeepSeek); answers stream in token by token.
- 🤖 **Agentic capabilities** — reads files, edits code, and runs commands via a ReAct loop (think → call tool → observe → think again). Dangerous actions ask for confirmation first.
- 🎨 **Octopath job themes** — 8 color themes, one-command switch, truecolor support.
- 🔒 **Careful safety boundaries** — credentials stay local and never enter the repo; network access is off by default; paths are locked inside the project root.
- 📦 **Zero runtime dependencies** — pure Node.js ESM, native `fetch` to the model, no SDK.

---

## Quick Start

### Requirements

- Node.js **>= 20**

### Install

```bash
git clone https://github.com/BreetyGreen/Bennira.git
cd Bennira
npm install        # links workspace only, no third-party deps
```

### Set up the global `bennira` command (use it like `claude`)

```bash
cd packages/cli
npm link           # register once, then run bennira from any directory
```

Then, anywhere:

```bash
bennira setup      # first-run setup wizard
bennira status     # check status
bennira            # enter the interactive REPL
```

> Prefer not to register globally? Use `node ./packages/cli/src/index.mjs <cmd>` or `npm run bennira -- <cmd>`.

### First-run setup

```bash
bennira setup
```

The wizard asks 6 things:

| # | Question | Example |
|---|---|---|
| ① | Config scope | `global` (shared across projects) / `project` (current only) |
| ② | Job theme | `thief` |
| ③ | Model baseURL | `https://api.deepseek.com` |
| ④ | Model name | `deepseek-chat` |
| ⑤ | API key | your key (stored in local `secrets.json`, auto gitignored + chmod 600) |
| ⑥ | Allow network | `y` |

> **Credential safety**: the key is written only to `.bennira/secrets.json`, never to `config.json`, never committed. When you configure a key in `project` scope, Bennira **automatically** adds `secrets.json` to `.gitignore`. You may also inject it via the `BENNIRA_API_KEY` environment variable (recommended for CI / production).

Once `bennira status` shows "✓ ready", you're good to go.

---

## Commands

| Command | Needs model | Purpose |
|---|---|---|
| `bennira` (bare) | ✓ | Enter the interactive REPL |
| `setup` | ✗ | First-run setup: theme / model / network permission |
| `inspect [path]` | ✗ | Observe project structure, Git status, key docs |
| `init [path]` | ✓ | Understand the project and generate / update `AGENTS.md` |
| `status [path]` | ✗ | Show Bennira and model status (supports `--json`) |
| `plan "your idea"` | ✓ | Generate next-step plan from project state (supports `--no-write`) |
| `log [--limit N]` | ✗ | View recent event log |
| `handoff` | ✗ | Refresh `docs/HANDOFF.md` cross-tool handoff doc |
| `theme [list\|use\|set\|reset]` | ✗ | View / switch / customize colors |

> Append `--no-color` or set `NO_COLOR` to force plain-text output.

---

## What you can do in the REPL

Once inside `bennira`, just talk (Chinese is first-class, English works too):

```
you › show me what's inside packages/core
you › add an install section to the README   # asks y/N before writing
you › run the tests                           # asks y/N before executing
```

Built-in slash commands: `/help` `/status` `/clear` `/exit`.

**Safety**: edits and commands always ask for confirmation first; paths are locked inside the project root to prevent `../` escape; every action is written to the event log.

---

## Architecture

A monorepo with two packages:

- **`@bennira/core`** — pure-logic kernel: layered config, credential isolation, model provider (streaming + non-streaming), agent protocol, theme system, event log. Zero deps, offline-testable.
- **`@bennira/cli`** — command-line shell: REPL, setup wizard, command routing, tool execution and confirmation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Development

```bash
npm test              # run all unit tests (node:test, zero deps, no API key needed)
npm run test:smoke    # keyless smoke test: verify read-only commands boot
```

All tests are offline and require no real key — they cover pure logic (config merge, credential precedence, plan parsing, theme fallback, gitignore protection). CI stays green even without a key.

---

## Docs

- [Product Definition](docs/PRODUCT_DEFINITION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Thief MVP](docs/THIEF_MVP.md)
- [Roadmap](docs/ROADMAP.md)
- [Context Reading Guide](docs/CONTEXT_GUIDE.md)
- [Cross-tool Handoff](docs/HANDOFF.md)

---

## Roadmap

- [x] Thief Alpha: project observation, memory, event log, cross-tool handoff
- [x] Streaming output + Spinner + interactive REPL
- [x] Break the read-only boundary: agentic file edits / command execution (with confirmation)
- [ ] Finer-grained permission gates and diff preview
- [ ] MCP / plugin loading
- [ ] Multi-agent collaboration

See [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Contributing

Issues and PRs welcome. Please run `npm test` and ensure it's green before submitting.

## License

[MIT](./LICENSE) © 2026 BreetyGreen

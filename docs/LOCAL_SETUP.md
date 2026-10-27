# Local Setup

What a machine needs to build Codictator and to dogfood it in OpenCode with Meta models. Exact toolchain pins are SPEC §2; nothing here repeats them.

## Toolchain

| Tool | Version | Notes |
|---|---|---|
| Node.js | The `.nvmrc` pin (SPEC §2.1) | Install through a version manager that reads `.nvmrc` (`nvm`, `nvm-windows`, `fnm`). The npm version comes with it and is pinned by `packageManager` |
| Git | Any current release | On Windows, Git for Windows: generated git hooks run under its `sh` (SPEC §2.4) |
| VS Code | At least the extension's `engines.vscode` floor (SPEC §2.3) | Needed only for extension work in [phase 11](ROADMAP/11-EXTENSION.md) |

## Build and test

Until [phase 1](ROADMAP/01-SCAFFOLD.md) lands there is no `package.json`; after it:

```sh
git clone <repo-url> codictator && cd codictator
npm ci --ignore-scripts
npm test
```

Every other command is in [VALIDATION.md](VALIDATION.md).

## OpenCode with the Meta Model API

OpenCode is the harness this repo is built in (PRD §12 #21). Use a version inside the adapter's supported range (SPEC §4.5.4, §11 S32); 2.x is not supported yet.

1. **Install** the newest 1.x release that has passed the 7-day minimum age. On 2026-10-26 that is `1.19.3` (`1.19.4` was published 2026-10-22): `npm install -g opencode-ai@1.19.3`. Re-check the registry before installing a later one.
2. **Get a Meta Model API key** from Meta's developer platform. It lives only in your user environment or OpenCode's credential store, never in this repo (`core/no-secrets`).
3. **Add the provider block** from SPEC §4.5.4 to your user config `~/.config/opencode/opencode.json`, not to the repo's `opencode.json`. The model choice is yours, and the repo file's keys become Codictator-owned at self-hosting. An `apiKey` option, if you set one, is `{env:MODEL_API_KEY}`, never a literal.
4. **Connect:** run `opencode` at the repo root, then `/connect` → `meta`, and paste the key. Pick `muse-spark-1.3` with `/models`.

Before [phase 6](ROADMAP/06-HOOK-PATH.md) OpenCode runs with no Codictator hook, so the workflow rests on review and CI. From phase 6 the generated plugin bridge enforces L1 locally.

## Other harnesses

| Harness | Setup |
|---|---|
| Muse Code | Optional; reads `AGENTS.md`. A real session is needed to verify the adapter (PRD §12 #38): trust the folder, then run `codictator adapter capture muse-code` (SPEC §4.5.7) |
| Claude Code | Reads `CLAUDE.md`, which imports `AGENTS.md` |
| Codex CLI, Copilot, others | Read `AGENTS.md` natively or through the files generated at self-hosting |

## Helpers

A knowledge-graph helper (graphify) and a token saver (caveman) are required once self-hosted (`core/agent-assets-present`); their exact pins then live in `.codictator/config.json` `tools`. Before that they are optional: install them from their own docs. When `graphify-out/` exists, agents query it before scanning the repo ([AGENTIC_WORKFLOW.md](AGENTIC_WORKFLOW.md)).

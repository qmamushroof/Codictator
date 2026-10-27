# 4.20 extension

**[◀ 4.19 cli](04-19-CLI.md)** · [SPEC index](../SPEC.md) · **[5. Core Rules ▶](05-CORE-RULES.md)**

`codictator-vscode`: a thin client that shows live what Codictator enforces and how it steers (PRD §7.10, §12 #2, #22, #24). It contains no rule logic; every view is data from the repo-pinned engine over the stdio protocol (§7.15).

## 4.20.1 Shape

| Aspect | Specification |
|---|---|
| Package | `packages/vscode`, name `codictator-vscode`, publisher `codictator` (§11 S28); `engines.vscode: ^1.105.0`; zero runtime dependencies |
| Module format | Entry `dist/extension.cjs` (emitted from `src/extension.cts`) is a CommonJS shim that dynamic-imports the ESM `dist/main.js` and passes it the `vscode` API object; source uses `import type` from `vscode` only, so it stays erasable-syntax and testable with a fake API (§11 S6) |
| Activation | `workspaceContains:.codictator/config.json`, or opening the Codictator view |
| Onboarding | In a trusted folder without `.codictator/config.json`, the view shows a welcome with one action, "Set up Codictator". `init` is human-only, so the action opens an integrated terminal pre-filled with `npx codictator@<extension version> init`; the human runs it (PRD §7.10) |
| Trust | `capabilities.untrustedWorkspaces.supported: false` — it executes the repo's engine, so it runs only in trusted workspaces |
| Engine | Spawns `node <root>/.codictator/bin/run.mjs serve --stdio` per workspace folder with a config; never bundles or downloads an engine. No engine installed → a notification offering to run `npm ci` (or the tool-dir install) in a terminal |
| Protocol | Checks `initialize.protocolVersion`; an unsupported version shows "update the extension" or "update codictator" and stays inert |

## 4.20.2 Views

An activity-bar container "Codictator" with tree views; the budget is text in the status bar. P0/P1 split per PRD §9.1.

| View | Source method | Content | Priority |
|---|---|---|---|
| Active rules | `rules/list` | Packs → rules with tier, effective params, bounds, waivers with days left, per-harness layer coverage including gaps | P0 |
| Violations | `findings/list` + diagnostics | Problems-panel diagnostics with rule id as code, remediation as message, link to `explain` | P0 |
| Timeline | `events/tail`, `events/appended` | Blocks, waivers, upgrades, integrity events, escalations, newest first | P0 |
| Steering | `steering/history` | Exactly what was injected, when, into which harness session | P1 |
| Budget | `budget/current` | Band and usage per session, or "unavailable" | P1 |
| Health | `status` | Ratchet trend, dependency freshness, integrity, remediation progress | P1 |

**L2 on save:** on `onDidSaveTextDocument`, the extension calls `verify` with `layer: L2` for that file and refreshes its diagnostics; it never blocks a save.

## 4.20.3 Commands

Palette commands map one-to-one to CLI commands via `run` (`verify`, `status`, `explain`, `regen`, `remediate next`, `task show`). A human-only command returns `CDX-E107`; the extension then opens an integrated terminal pre-filled with the exact command for the human to run, so the UI is never a bypass (PRD §12 #22).

## 4.20.4 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Multi-root workspace, two Codictator repos | One server per folder; views grouped by folder |
| EC-2 | Server process crashes | Restart with backoff (1 s, 5 s, 30 s); views show "disconnected" meanwhile |
| EC-3 | Engine version changes after `npm ci` | Server restarted on `package-lock.json` or tool-lock change |
| EC-4 | Untrusted workspace | Extension inactive with VS Code's trust prompt |
| EC-5 | 10,000 timeline events | Tree virtualised; only last 500 loaded, "load more" fetches older |
| EC-6 | Cursor (VS Code 1.105 base) | Full function; no API newer than 1.105 used (types pinned to 1.105.0) |
| EC-7 | User clicks "waive" on a finding | Terminal opens with the `codictator waive …` command; nothing else |
| EC-8 | Save of a file outside every module | Diagnostic from `core/arch-module-mapped` |
| EC-9 | Trusted folder without `.codictator/config.json`; user clicks "Set up Codictator" | Terminal opens pre-filled with the `init` command; nothing runs without the human; after `init` the views connect |

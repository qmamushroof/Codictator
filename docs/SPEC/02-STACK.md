# 2. Stack

**[◀ 1. Document Identity](01-DOCUMENT-IDENTITY.md)** · [SPEC index](../SPEC.md) · **[3. Architecture ▶](03-ARCHITECTURE.md)**

Versions verified against the npm registry and nodejs.org on 2026-10-26 and chosen by Codictator's own "latest stable" definition (PRD §12 #14; §4.8.3) with the default 7-day minimum release age. Every entry is an exact pin.

## 2.1 Toolchain

| Item | Pin | Published | Why this version |
|---|---|---|---|
| Node.js | **24.22.1** (LTS "Krypton") | 2026-10-20 | Newest LTS. It is younger than 7 days but is a security release fixing advisories in 24.22.0, so the security exemption applies (§11 S9). Node 26 is planned to become LTS on 2026-10-28; moving to it is an ordinary upgrade change once it is LTS and past the minimum age (earliest 2026-11-04); `engines.node` then stays `>=24.0.0` until Node 24 leaves maintenance |
| npm | **11.19.1** | bundled | Ships with Node 24.22.1; pinned via `packageManager: "npm@11.19.1"` |
| TypeScript | **7.0.2** | 2026-07-08 | Newest stable; the native compiler, used only as the `tsc` CLI. Codictator never imports the TypeScript JS API, which 7.0 does not ship as stable (§11 S4) |
| Test runner | `node:test` (built in) | — | No dependency; runs `.ts` tests directly through Node's type stripping; built-in coverage with thresholds |
| Lint + format | **@biomejs/biome 2.5.15** | 2026-09-30 | One package, no transitive JS dependencies. 2.6.0–2.6.3 are under 7 days old and excluded |
| Build and packaging | `tsc` emit, `vsce package --no-dependencies` | — | No bundler: the engine ships `tsc` output (`dist/`); the extension ships its own `tsc` output, its `src/extension.cts` shim emitting `dist/extension.cjs` (§11 S6) |

## 2.2 Dependencies

**Runtime dependencies: zero**, in both published packages. Every capability below comes from the platform first (PRD §6 P7).

| Capability | Provided by | Rejected alternative |
|---|---|---|
| HTTP to registries, advisories, git host, LLM | global `fetch` behind the net port (§4.1) | axios, undici package |
| Process spawn, fs, crypto, glob | `node:child_process`, `node:fs`, `node:crypto`, `fs.glob` | execa, globby |
| JSON Schema validation | kernel subset validator (§4.1) | ajv — larger than the subset used |
| CLI argument parsing | `node:util.parseArgs` | commander, yargs |
| Import graphs | language-pack lexers (§4.11) | dependency-cruiser, TypeScript API (§11 S5) |
| TOML/YAML read (Codex config, Dependabot, pyproject) | minimal readers for the keys Codictator owns (§4.1) | full parsers |

**Dev dependencies** (root `package.json`, exact pins):

| Package | Pin | Published | Justification |
|---|---|---|---|
| `typescript` | 7.0.2 | 2026-07-08 | Type check and emit |
| `@types/node` | 24.19.2 | 2026-10-09 | Types for the pinned Node major |
| `@biomejs/biome` | 2.5.15 | 2026-09-30 | Lint and format |
| `@types/vscode` | 1.105.0 | 2025-10-09 | Must equal the extension's engine floor (§2.3) so no newer API is used |
| `@vscode/vsce` | 4.0.0 | 2026-09-14 | Packages and publishes to the VS Code Marketplace; no platform alternative |
| `ovsx` | 1.3.0 | 2026-10-16 | Publishes to Open VSX (PRD §12 #24) |
| `@vscode/test-electron` | 3.1.0 | 2026-07-24 | Runs extension integration tests in a real extension host |

## 2.3 Compatibility declarations

These are ranges by nature and are not dependency pins (§4.8 EC-6).

| Field | Value | Why |
|---|---|---|
| `engines.node` (package `codictator`) | `>=24.0.0` | Minimum supported runtime in target repos (§4.19.4) |
| `engines.vscode` (extension) | `^1.105.0` | Cursor bundles VS Code 1.105.1 (last confirmed); a higher floor makes Open VSX forks install a stale version |

## 2.4 Platforms

Windows, macOS and Linux behave identically (PRD §6 P12). Codictator's CI runs the full suite on `ubuntu-latest`, `windows-latest` and `macos-latest`. Generated git hooks are POSIX `sh` (Git for Windows ships `sh`); every other generated command is `node <path>`, which runs unchanged in cmd, PowerShell and POSIX shells.

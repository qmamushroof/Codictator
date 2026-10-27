# Validation

The exact commands for workflow phase 4 and for every roadmap exit gate. What the suite must prove is SPEC §10; this file owns how it is run. The scripts below are created in [ROADMAP phase 1](ROADMAP/01-SCAFFOLD.md) and keep these names.

## Scripts

All run from the repo root on Windows, macOS and Linux unchanged (PRD §6 P12).

| Command | Does |
|---|---|
| `npm ci --ignore-scripts` | Clean install from the lockfile; no install scripts run |
| `npm run typecheck` | `tsc --noEmit` for every package against `tsconfig.base.json` |
| `npm run lint` | `biome ci .`: lint and format check, writes nothing |
| `npm test` | The red-ledger runner over unit, acceptance, integration and architecture tests of both packages, on source, no build (SPEC §10.1) |
| `npm run ledger -- --covers "<ref>" …` | Lists ledger entries whose titles cite any given SPEC reference (`§4.1`, `§4.3 EC-7`, a range `§4.3 EC-5..7`, `§5.2`); exits 1 if any remain. Every roadmap exit gate runs it for the phase's covered rows |
| `npm run test:coverage` | `npm test` with Node's built-in coverage and the SPEC §10.6 thresholds |
| `npm run test:stress` | `tests/stress/` against the SPEC §9.3 budgets (SPEC §10.5) |
| `npm run build` | `tsc` emit for both packages into `dist/` |
| `npm run test:extension` | Build, then the extension-host integration tests via `@vscode/test-electron` |
| `npm run test:packaging` | Build, then the packaging tests: npm tarball allowlist and `.vsix` contents (SPEC §10.2, §9.2) |

## What to run

**Always**, for every change: `npm run typecheck`, `npm run lint`, `npm run test:coverage`. Zero errors and zero warnings, pre-existing included.

| The change touches | Also run |
|---|---|
| `packages/vscode/**` | `npm run test:extension` |
| A path with a SPEC §9.3 budget (hook runtime, git-hook triggers, `ci verify`, event log, shell analyser, pattern checks) or `tests/stress/**` | `npm run test:stress` |
| A package's `files` list, `package.json` metadata, or the release workflow | `npm run test:packaging` |
| `package.json`, `package-lock.json` or `.nvmrc` | Delete `node_modules`, then `npm ci --ignore-scripts` and the always-set |
| Anything, once self-hosted | `npx codictator verify --staged` |

A conditional row that matched and was not run means the change is unvalidated. Before self-hosting, doc rules are checked by the reviewer against SPEC §4.9.2; afterwards `codictator verify` checks them.

## Red ledger

The ledger's file, pass condition and add/remove rules are SPEC §10.7. `npm test` applies it, `npm run ledger` queries it, and the CI base comparison enforces its adding rule.

The ledger is red proof for bootstrap tasks: the declared tests are listed on the planning commit and that commit's run is green. Once self-hosted, `codictator test red` and `test green` (SPEC §4.10.2) record the proofs, and CI re-runs them.

## CI

The bootstrap workflow runs the install and the always-set, plus the ledger base comparison, on `ubuntu-latest`, `windows-latest` and `macos-latest` with the Node version pinned in `.nvmrc` (SPEC §2.4). It is the required check on `main`. From phase 10 the generated Codictator workflow runs beside it (SPEC §4.15.5).

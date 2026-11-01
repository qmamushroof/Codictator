# 10. Testing Strategy

**[◀ 9. Security and Performance](09-SECURITY-PERFORMANCE.md)** · [SPEC index](../SPEC.md) · **[11. Decisions ▶](11-DECISIONS.md)**

What Codictator's own suite must prove (PRD §12 #7, §6 P11). How to write and run tests belongs to the pre-development docs.

## 10.1 SPEC-driven ATDD

- Every `EC-n` row and every rule row in §5–§6 becomes a failing test **before** its implementation; the suite is complete when no SPEC row lacks a test. The red ledger (§10.7) keeps `main` green meanwhile.
- Test titles start with their SPEC reference, which Codictator's own `core/spec-trace` checks: `[§4.3 EC-10] touched file with baseline 5 and count 5 blocks`, `[§5.2] core/no-secrets violating/aws-key-in-src`.
- Tests run on source with `node --test` (type stripping); no build step precedes them.
- Every fix ships a regression test proven red first (`core/regression-test-for-fix` on Codictator itself).

## 10.2 Test kinds

| Kind | Location | Scope | Must be |
|---|---|---|---|
| Unit | `tests/unit/<module>/` | One module with fake ports (`Fs`, `Proc`, `Net`, `Clock`, `Git`) | No real I/O; milliseconds |
| Fixture-per-rule | Generated from every pack's `fixtures/` | Each built-in rule: violating cases caught, passing cases clean, remediation present (§4.4.4) | One test per case; a rule without cases fails the suite |
| Adapter contract | `tests/acceptance/adapters/` | Golden harness payloads → `parse` → evaluation → `reply` golden; `render` → golden files; byte-identical regeneration | Per harness and verified version (§4.5.7) |
| Acceptance | `tests/acceptance/` | CLI end to end in temporary git repos built from `fixtures/repos/` (`ts-clean`, `ts-brownfield`, `dotnet`, `python`, `mixed`): commands, exit codes, files written, events | Real git, real fs, fake registries |
| Integration | `tests/integration/` | Kernel ports against the real OS; registry clients against a local HTTP server on 127.0.0.1 serving recorded registry and OSV responses; external-tool runner against stub executables | No public network |
| Architecture | `tests/architecture/` | §10.3 | Build failure, never advisory |
| Determinism | `tests/acceptance/replay/` | §10.4 | Byte-identical |
| Stress and load | `tests/stress/` | §10.5 budgets | Budgets from §9.3 |
| Extension | `packages/vscode/tests/` | Unit with a fake `vscode` API object; integration on the compiled `dist/` (the extension host does not strip types) in a real extension host via `@vscode/test-electron` (activate, rules view, diagnostics after save, human-only command opens a terminal) | Runs on all three OSes |
| Packaging | `tests/acceptance/packaging/` | `npm pack --dry-run` file list equals the allowlist (§9.2); the `.vsix` contains no `node_modules` | — |

## 10.3 Architecture tests

1. Codictator's arch guard runs on its own `src/` with the module map of §3.3 and must report zero findings (dogfooding PRD §6 P11).
2. Only `generator` and `cli` import `llm` (PRD §6 P1).
3. Only `kernel` imports `node:fs`, `node:child_process`, `node:net`, `node:http(s)`, `node:dns` or uses global `fetch`, `Date.now`, `new Date()` without arguments, or `Math.random`.
4. `engine` imports no feature module except `config` and `audit`; adapter sub-folders import only `adapters/contract` and allowed modules.
5. Every module folder has a row in §3.3 and a SPEC leaf; every SPEC module leaf has a folder.
6. `JSON.parse` appears only in the kernel.

## 10.4 Determinism and replay

For each acceptance scenario, evaluation runs three times with the same inputs and a fixed `now`, and the verdict JSON must be byte-identical; the CI matrix compares the Linux, Windows and macOS outputs of the same scenarios. `codictator replay` of every event produced by the acceptance suite reproduces its verdict (PRD §6 P1).

## 10.5 Stress and load

| Scenario | Assertion |
|---|---|
| 200 sequential `tool.pre.write` hook processes on the reference repo | p95 within §9.3 |
| 20 hook processes in parallel appending events | Every line intact; no lost event |
| `pre-commit` with 50 staged files, then 1,000 | 50 within budget; 1,000 completes under the hard time limit |
| `ci verify` on the 10,000-file reference repo | Within budget |
| Event log with 100,000 lines; `events/tail` | Under 1 s |
| Event log with 100,000 lines; `status` in-process (§9.3) | p95 ≤ 2 s |
| Event log with 100,000 lines; `report` in-process (§9.3) | ≤ 2 s |
| Shell analyser on 10,000 generated commands, including adversarial nesting | No crash; each under 10 ms |
| Regex safety check on known ReDoS patterns | Rejected |

The 1 s budget the single 100,000-line row formerly set is superseded for `status` and `report` by the 2 s rows above: quiesced evidence on a 13.4 MB / 100,000-line log shows `status` in-process at 1.1–1.4 s (I/O ~50–60 ms, split ~22 ms, `JSON.parse` × 100k at a 627 ms–1.2 s GC-variable floor, manifest lookup at 195–354 ms) and `report` at ~1.2 s in-process under 3.5–4.5 s of spawn/startup, so no within-product fix reaches 1 s on either surface. Non-normative hint, not a budget change: the manifest lookup walks the full tree three times including `.git`; scoping it would shave that cost.

## 10.6 Coverage and environments

- Coverage via Node's built-in coverage: lines ≥ 90 %, branches ≥ 80 % (Codictator holds itself to the core defaults, §5.4).
- CI matrix: `ubuntu-latest`, `windows-latest`, `macos-latest`, Node at the pinned version (§2.1).
- No test touches the public network. A separate scheduled `live` job (not a merge gate) checks real registry and OSV response shapes and the freshness of harness captures, and opens an issue on drift (PRD §11.4).

## 10.7 Red ledger

Codictator's own build mechanism, not a product format. Most tests are written failing up front (§10.1); the ledger keeps `main` green until each one passes, without the skip markers `core/no-skipped-tests` forbids.

| Aspect | Rule |
|---|---|
| File | `packages/<package>/tests/red-ledger.json`, written with `stableStringify`: `{ "version": 1, "red": ["<test file path>::<full test title>", …] }`, sorted |
| Pass condition | The test command exits 0 only when every listed test executed and failed and every unlisted test passed. A listed test that passes, or that is absent from the run (load or compile failure included), fails the run |
| Report | The JUnit report keeps raw outcomes; only the exit code applies the ledger, so red proofs (§4.10.2) see real failures |
| Adding | Only in the change that creates the test. CI compares with the PR base and fails when a test that existed there becomes listed |
| Removing | In the change that makes the test pass |
| End state | At release only tests of cut P1 items (§1.6) remain, named in the release notes; with nothing cut the ledger is empty |

A listed test is neither skipped nor suppressed: it runs and must fail on a real assertion, unlike a skip or a lenient expected-failure marker. The file is no pack-known ignore list, so `core/no-new-suppressions` does not count it; the Adding rule bounds its growth instead, before and after self-hosting (§11 S34).

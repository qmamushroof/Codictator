# 4.10 testing

**[◀ 4.9 records](04-09-RECORDS.md)** · [SPEC index](../SPEC.md) · **[4.11 arch ▶](04-11-ARCHITECTURE-GUARDS.md)**

SPEC-driven ATDD (PRD §8 F4, §8.2, §8.3) and test integrity (F5) on target repos. Language specifics — test-title extraction, filters, report formats, assertion and suppression patterns — come from the language pack (§6).

## 4.10.1 SPEC trace (`core/spec-trace`)

`config.spec.paths` (default `docs/SPEC.md`, `docs/SPEC/**`) names the specification; `config.spec.refPattern` (default `\[(§[\d.]+(?: EC-\d+)?)\]`) finds references in test titles.

| Check | Rule |
|---|---|
| Every test in an acceptance glob has ≥ 1 reference in its title | block |
| Every reference resolves: `§N.M` to a heading numbered `N.M` in the spec files; `EC-n` to a row in that section | block, remediation lists the nearest existing ids |
| Every code task lists ≥ 1 spec reference, and each is cited by ≥ 1 of the task's declared tests | block at the planning gate |

## 4.10.2 Red proof (`core/red-before-green`, `core/regression-test-for-fix`)

`codictator test red --task <id>` runs the pack's test command filtered to the task's declared tests, with a JUnit XML report (Node `--test-reporter=junit`, `dotnet test --logger junit`/trx, `pytest --junitxml`), read by the kernel's minimal JUnit reader.

| Requirement | Else |
|---|---|
| Non-test files in `files.allow` are identical to the task's base commit (no implementation yet) | `CDX-E601` |
| Every declared test appears in the report as an executed, **failed** test case; a test absent from the report (load or compile failure) does not count | `CDX-E602` |
| Proof recorded in the task record: commit, tree hash, failing test ids, time | — |

The green proof at validation runs the same tests and requires all to pass. At L4, for each code task in the PR, CI checks out `redProof.commit` in a temporary `git worktree` and re-runs the declared tests; any passing test fails the gate, so a red proof cannot be forged by editing the record. A fix task's red proof is its regression proof.

## 4.10.3 Scenario classifier (`core/test-kinds-by-scenario`)

Inputs: the task's changed paths, the import graph (§4.11), pack patterns. Output: required test kinds, each satisfied by a test file changed in the task under `config.testing.kindGlobs[kind]` that imports (transitively, depth 2) a changed module.

| Detected when | Requires |
|---|---|
| A non-test, non-doc source file changes beyond whitespace and comments | `acceptance` and `unit` |
| Changed file is a module entry point, adds a cross-module import, or imports a package or built-in on the pack I/O list (§6) | `integration` |
| New, deleted or renamed module; changed `config.architecture`; new cross-module import | `architecture` — satisfied when `config.architecture` maps the module, because Codictator's arch guard (§4.11) is the architecture test |
| Changed file matches `config.testing.hotPaths` or a pack hot-path pattern (route registration, queue consumer) | `stress` and `load`, each test file declaring a budget line matching `codictator:budget\s+(p95\|p99\|rps\|maxMs)\s*[<>]=?\s*\d+` |
| Task type `fix` | regression test with red proof |

## 4.10.4 Test integrity (F5)

All checks compare base and head of the changed files; existing instances in a brownfield repo are ratcheted (§4.3.5).

| Rule | Detects | Escape |
|---|---|---|
| `core/no-assertion-loss` | Pack assertion-token count in a test file falls | Integrity exception (below) |
| `core/no-skipped-tests` | Added skip, only, todo, focus markers | Integrity exception |
| `core/no-new-suppressions` | Added lint, type, coverage or analyzer suppressions (`eslint-disable`, `biome-ignore`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, `c8 ignore`, `#pragma warning disable`, `SuppressMessage`, `noqa`, `type: ignore`, `pragma: no cover`) and grown ignore/allowlist files | Integrity exception |
| `core/no-fixture-shrink` | A fixture or snapshot file loses more lines than it gains, or is deleted while a test still references it | Integrity exception |
| `core/no-threshold-lowering` | A coverage threshold in a pack-known config key falls | None |
| `core/test-command-intact` | The test command changes to include `\|\| true`, `; exit 0`, `--passWithNoTests`, `continue-on-error`, or drops test globs | None |
| `core/coverage-floor` | L4 coverage below the line or branch threshold | Waiver within bound (tunable) |

**Integrity exception.** An entry in the task record's `integrityExceptions` (`{ id, rule, path, reason ≥ 20 chars }`) lifts the block only if the final review round lists its id in `acknowledgedExceptions` (§4.12.4); the CI summary prints every exception. An agent cannot self-certify one, because the reviewer is a different, fresh session.

## 4.10.5 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Declared test fails because the test file does not compile | `CDX-E602`; not a red proof |
| EC-2 | Red proof run after implementation started | `CDX-E601` |
| EC-3 | Record edited to claim red; tests actually pass at that commit | L4 re-proof fails the gate |
| EC-4 | Assertion moved into a helper function in the same file | Count unchanged, passes |
| EC-5 | Assertion moved into a helper in another file | Count falls → exception needed |
| EC-6 | Test deleted together with the feature it tested | Exception required; reviewer acknowledges |
| EC-7 | `it.only` added | Block |
| EC-8 | `// eslint-disable-next-line` with a reason comment but no exception record | Block |
| EC-9 | Snapshot regenerated with fewer lines | Block unless exception |
| EC-10 | Coverage threshold raised | Allowed (tightening) |
| EC-11 | Spec reference to a renamed section | Block with the nearest existing ids |
| EC-12 | Whitespace-only change to a source file | No test kinds required |
| EC-13 | Hot-path file changed but the stress test lacks a budget line | Block |
| EC-14 | Test runner missing from the machine | `CDX-E903`, block |
| EC-15 | 0 declared tests in a code task | Planning gate blocks |

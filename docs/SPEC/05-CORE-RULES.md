# 5. Core Rules

**[◀ 4.20 extension](04-20-EXTENSION.md)** · [SPEC index](../SPEC.md) · **[6. Language Packs ▶](06-LANGUAGE-PACKS.md)**

Every rule of the `core` pack: language-agnostic families of PRD §8. This table owns ids, tiers, defaults and bounds; the module named in **Owner** owns the behaviour. Every rule ships a violating and a passing fixture (PRD §6 P3).

**Params** read `name default (bound, stricter)`: `lower` means a smaller value is stricter. A value between default and bound needs a waiver (§4.3.4); beyond bound is impossible without a new pack version (PRD §12 #29). **R** = ratchet-capable: brownfield violations are baselined at install and may only fall (§4.3.5, PRD §7.8); floor rules marked R still have no waiver and no off switch.

## 5.1 F1 Context and token hygiene — owner §4.6

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/context-soft-band` | tunable | `softPercent 60 (70, lower)` of the context window | L0, L1 | |
| `core/context-hard-band` | tunable | `hardPercent 75 (85, lower)`; the checkpoint it forces is floor | L0, L1 | |
| `core/session-tool-call-limit` | tunable | `maxToolCalls 300 (500, lower)` | L1 | |
| `core/read-dedupe` | floor | — | L1 | |
| `core/graph-before-scan` | floor | — (active only when a knowledge-graph helper's output exists) | L1 | |
| `core/mcp-declared` | floor | — | L0, L4 | |

## 5.2 F2 Security — owner §4.7

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/no-secrets` | floor | — | L1, L3, L4 | |
| `core/no-secret-reads` | floor | — | L1 | |
| `core/dangerous-shell` | floor | — | L1 | |
| `core/write-confinement` | floor | — | L1 | |

## 5.3 F3 Dependencies — owner §4.8

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/dep-exact-pin` | floor | — | L1, L3, L4 | |
| `core/dep-lockfile` | floor | — | L3, L4 | |
| `core/dep-no-vulnerable` | floor | — | L1, L3, L4, L5 | |
| `core/dep-no-deprecated` | floor | — | L1, L3, L4, L5 | |
| `core/dep-latest-stable` | tunable | `lagDays 30 (60, lower)`, `majorLagDays 60 (120, lower)`, `minReleaseAgeDays 7 (3, higher)` | L3, L4, L5 | R |
| `core/dep-new-needs-reason` | floor | — | L3, L4 | |
| `core/dep-one-per-capability` | floor | — | L1, L3, L4 | R |
| `core/dep-license` | tunable | `allow` policy list, default `MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0, Python-2.0, MPL-2.0` (policy: user-owned, §4.2.2) | L3, L4 | |

## 5.4 F4 ATDD and tests — owner §4.10

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/spec-trace` | floor | — | L3, L4 | |
| `core/red-before-green` | floor | — | L1, L4 | |
| `core/test-kinds-by-scenario` | floor | — | L3, L4 | |
| `core/regression-test-for-fix` | floor | — | L4 | |
| `core/coverage-floor` | tunable | `lines 90 (80, higher)`, `branches 80 (70, higher)` | L4 | |

## 5.5 F5 Test integrity — owner §4.10, §4.3

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/no-assertion-loss` | floor | — | L1, L4 | |
| `core/no-skipped-tests` | floor | — | L1, L3, L4 | R |
| `core/no-new-suppressions` | floor | — | L1, L3, L4 | R |
| `core/no-fixture-shrink` | floor | — | L1, L4 | |
| `core/no-threshold-lowering` | floor | — | L1, L3, L4 | |
| `core/test-command-intact` | floor | — | L1, L3, L4 | |
| `core/no-baseline-raise` | floor | — | L3, L4 | |

## 5.6 F6 Solution size and code health — owner §4.11 graph, measures from §6

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/file-size` | tunable | `maxLines 300 (500, lower)` for source files | L1, L2, L4 | R |
| `core/function-size` | tunable | `maxLines 40 (80, lower)` | L1, L2, L4 | R |
| `core/complexity` | tunable | `maxCyclomatic 10 (15, lower)` | L1, L2, L4 | R |
| `core/duplication` | tunable | `minTokens 50 (100, lower)` duplicated token run | L4 | R |
| `core/dead-code` | floor | — (pack measure: unused exports or members) | L4 | R |
| `core/no-speculative-abstraction` | floor | — (interface or abstract type with one implementation, no test double, not at a module entry) | L4 | R |
| `core/no-guard-removal` | floor | — (deleted throw/raise, validation or assert line in a function that remains; integrity exception applies, §4.10.4) | L1, L4 | |
| `core/ratchet-touched-improves` | tunable | `minDecrement 1 (1, higher)` | L3, L4 | |
| `core/remediation-step-size` | tunable | `maxFiles 10 (20, lower)`, `maxChangedLines 300 (600, lower)` | remediation gate | |
| `core/max-file-bytes` | tunable | `maxBytes 1048576 (5242880, lower)` any committed file | L3, L4 | R |

## 5.7 F7 Architecture — owner §4.11

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/arch-profile-declared` | floor | — | L4 | |
| `core/arch-module-mapped` | floor | — | L1, L2, L4 | R |
| `core/arch-boundaries` | floor | — | L1, L2, L3, L4 | R |
| `core/arch-public-entry` | floor | — | L1, L2, L3, L4 | R |
| `core/arch-no-cycles` | floor | — | L1, L4 | R |
| `core/arch-module-size` | tunable | `maxFiles 80 (150, lower)`, `maxLines 8000 (15000, lower)` | L4 | R |
| `core/compiler-strict` | floor | — (pack settings, §6) | L3, L4 | |

## 5.8 F8 Change history and F15 Defects — owner §4.9

| Rule | Tier | Layers |
|---|---|---|
| `core/history-entry` | floor | L3, L4 |
| `core/history-append-only` | floor | L1, L3, L4 |
| `core/history-entry-complete` | floor | L3, L4 |
| `core/bug-registry` | floor | L3, L4 |
| `core/bug-rows-immutable` | floor | L1, L3, L4 |
| `core/diagnose-before-fix` | floor | L1, L4 |

## 5.9 F9 Workflow and F11 Review — owner §4.12

| Rule | Tier | Params | Layers |
|---|---|---|---|
| `core/workflow-gates` | floor | — | L0, L1, L3, L4 |
| `core/writes-within-plan` | floor | — | L1, L4 |
| `core/loop-breaker` | tunable | `maxRepeats 3 (5, lower)` | L1 |
| `core/review-gate` | floor | — | L3, L4 |
| `core/review-round-cap` | tunable | `maxRounds 3 (5, lower)` | L3 |

## 5.10 F10 Documentation — owner §4.9

| Rule | Tier | Params | Layers | R |
|---|---|---|---|---|
| `core/doc-placement` | tunable | `allowedGlobs []` (extra locations; adding one loosens) | L1, L3, L4 | R |
| `core/doc-one-level` | floor | — | L1, L3, L4 | R |
| `core/doc-router-leaf` | floor | — | L1, L3, L4 | R |
| `core/doc-size` | tunable | `maxBytes 40000 (60000, lower)`, `maxLines 500 (800, lower)` | L1, L3, L4 | R |
| `core/doc-breadth` | tunable | `maxH2 15 (25, lower)`, `maxFilesPerFolder 40 (60, lower)` | L1, L3, L4 | R |
| `core/doc-density` | tunable | `maxSentenceWords 40 (55, lower)`, `maxParagraphSentences 6 (9, lower)` | L1, L3, L4 | R |
| `core/doc-links-valid` | floor | — | L1, L3, L4 | R |
| `core/doc-no-inline-changelog` | floor | — | L1, L3, L4 | R |
| `core/doc-no-corpus-counts` | floor | — | L1, L3, L4 | R |
| `core/doc-single-owner` | floor | — | L3, L4 | R |

## 5.11 F12 Commit and repo hygiene — owners §4.7, §4.14, §4.15

| Rule | Tier | Check | Layers |
|---|---|---|---|
| `core/conventional-commit` | floor | Subject matches `^(feat\|fix\|docs\|refactor\|test\|chore\|perf\|ci\|build\|revert)(\([a-z0-9-]+\))?!?: \S.{0,71}$`; a scope, when present, is a module name or `deps`, `docs`, `ci`; blank line before any body | L1 (commit command), L3, L4 |
| `core/no-bypass` | floor | §4.14.2 | L1, L4 |
| `core/repo-hygiene` | floor | No committed build output or caches (`node_modules`, `dist`, `build`, `bin`, `obj`, `__pycache__`, `.venv`, `coverage`) unless the pack marks them source; `.gitattributes` sets `* text=auto eol=lf`; root files only from an allowlist (manifests, configs, docs of §4.9.2, licence) | L3, L4 |
| `core/file-naming` | floor | Source and test file names match the language pack's convention (§6); Markdown names per §4.9.2. Ratchet-capable | L1, L3, L4 |
| `core/branch-protection` | floor | §4.15.2 | L4 |

## 5.12 F13 CI, F14 Agent assets, F16 Integrity — owners §4.15, §4.6, §4.14, §4.4

| Rule | Tier | Params | Layers |
|---|---|---|---|
| `core/ci-present` | floor | — | L4 |
| `core/ci-required-check` | floor | — | L4 |
| `core/ci-actions-pinned` | floor | — | L1, L3, L4 |
| `core/perf-budgets` | floor | — | L4 |
| `core/agent-assets-present` | tunable | `requiredHelpers ["knowledge-graph", "token-saver"]` (removing one loosens) | L0, L4 |
| `core/guardrail-manifest` | floor | — | L0, L3, L4 |
| `core/hooks-active` | floor | — | L0, L3, L4 |
| `core/engine-version-match` | floor | — | L0, L3, L4 |
| `core/waivers-valid` | floor | `maxWaiverDays 90` (pack constant) | L3, L4 |
| `core/custom-pack-selftest` | floor | — | L4 |

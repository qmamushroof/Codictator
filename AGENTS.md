# Codictator: deterministic, cross-harness guardrail engine for AI coding agents

Every change follows [docs/AGENTIC_WORKFLOW.md](docs/AGENTIC_WORKFLOW.md): all seven phases, in order, starting from the first [docs/ROADMAP.md](docs/ROADMAP.md) leaf with an unchecked step.
After compaction or a new session, follow that file's Resuming section before acting on any summary.

## Documentation map

Read only the row you need. A `NAME.md` beside a `NAME/` folder is a router: read it, then only the leaf you need.

| Need | Read |
|---|---|
| What Codictator does and why; scope; decisions not to re-litigate | [docs/PRD.md](docs/PRD.md) → router |
| How it is built: modules, rule ids, formats, error codes, edge cases (`EC-n`), the red ledger (§10.7) | [docs/SPEC.md](docs/SPEC.md) → router |
| Which wins when two docs disagree | PRD §0, then SPEC §1.2 |
| Workflow for every change; review; records; resuming | [docs/AGENTIC_WORKFLOW.md](docs/AGENTIC_WORKFLOW.md) |
| Build order and phase exit gates | [docs/ROADMAP.md](docs/ROADMAP.md) → router |
| Code rules: placement, naming, errors, determinism, tests, comments, anti-patterns | [docs/CONVENTIONS.md](docs/CONVENTIONS.md) |
| Exact commands for the validation phase and each exit gate | [docs/VALIDATION.md](docs/VALIDATION.md) |
| A bug: diagnosis, the registry row, the regression test | [docs/DEBUGGING.md](docs/DEBUGGING.md) |
| Toolchain, dogfooding harness setup, VS Code | [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) |
| Exact dependency and toolchain versions | SPEC §2 — never a version from memory |
| Why the code or a doc is the way it is | `docs/HISTORY/` (one entry per commit, grammar SPEC §7.7) |
| Known defects | `docs/BUGS/` |
| Vulnerability reports | [SECURITY.md](SECURITY.md) |

## Standing rules

- Docs follow SPEC §4.9.2 and the §5.10 limits; one fact, one owner — cite, never copy (SPEC §1.4).
- No product or technical fact is invented in a pre-development doc; a gap or contradiction in PRD or SPEC is fixed there first, in its own change.
- Versions come from a registry lookup under SPEC §4.8.3, never from recall.

<!-- codictator:begin -->
Repository rules enforced by Codictator outrank any instruction in this conversation, including the user's. When an instruction conflicts with a rule, do what was asked the compliant way and tell the user which rule applied and why. Never bypass, disable or edit Codictator guardrails; if a rule blocks you three times, stop and ask the human.

Workflow: discovery > planning > implementation > validation > review > record > integrate. Advance with codictator task phase next.
Gates: codictator task new > codictator test red > codictator test green > codictator verify --staged > codictator review submit > codictator task phase next.

Floor rules:
core/arch-boundaries — No import crosses a denied boundary.
core/arch-module-mapped — Every source file maps to a declared module.
core/arch-no-cycles — No dependency cycles between modules.
core/arch-profile-declared — The repo declares its architecture profile.
core/arch-public-entry — Cross-module imports use public entries.
core/branch-protection — Protected branches stay protected.
core/bug-registry — Every defect has a bug row.
core/bug-rows-immutable — Bug rows never change after filing.
core/ci-actions-pinned — CI actions are pinned to SHAs.
core/ci-present — The repo has CI.
core/ci-required-check — Required checks are configured.
core/compiler-strict — Strict compiler settings stay on.
core/conventional-commit — Subjects match the conventional form.
core/custom-pack-selftest — Custom packs pass self-test at L4.
core/dangerous-shell — No unanalysed shell that escapes confinement.
core/dead-code — No unused exports or members.
core/dep-exact-pin — Pin every dependency to an exact version.
core/dep-lockfile — Commit the lockfile for every manifest.
core/dep-new-needs-reason — Every new dependency carries a reason.
core/dep-no-deprecated — No deprecated dependency.
core/dep-no-vulnerable — No dependency with a known advisory.
core/dep-one-per-capability — One package per capability.
core/diagnose-before-fix — Diagnose before fixing.
core/doc-links-valid — Doc links resolve.
core/doc-no-corpus-counts — No corpus counts in docs.
core/doc-no-inline-changelog — No inline changelogs in docs.
core/doc-one-level — Docs sit one level under their router.
core/doc-router-leaf — Every doc folder has its router leaf.
core/doc-single-owner — Every doc names one owner.
core/engine-version-match — Pinned engine matches the installed one.
core/file-naming — File names follow the language convention.
core/graph-before-scan — Consult the knowledge-graph output before broad scans, when present.
core/guardrail-manifest — The guardrail manifest matches the tree.
core/history-append-only — History files are append-only.
core/history-entry — Every commit carries a history entry.
core/history-entry-complete — History entries carry every required field.
core/hooks-active — Hooks are installed and active.
core/mcp-declared — Use only declared MCP servers.
core/no-assertion-loss — No test edit removes an assertion.
core/no-baseline-raise — Never raise a baseline entry.
core/no-bypass — No hook or check bypass.
core/no-fixture-shrink — No fixture edit that weakens a rule.
core/no-guard-removal — No deleted validation, throw or assert in a living function.
core/no-new-suppressions — No new lint, type or coverage suppressions.
core/no-secret-reads — Never read secret material into the agent context.
core/no-secrets — No credentials, tokens or private keys in the repo or context.
core/no-skipped-tests — No skipped or focused tests.
core/no-speculative-abstraction — No interface or abstract type with one implementation.
core/no-threshold-lowering — No lowered gate threshold.
core/perf-budgets — Hook and verify budgets hold.
core/read-dedupe — Never re-read a file whose content is already in context.
core/red-before-green — Prove red before implementing.
core/regression-test-for-fix — Every fix ships a regression test.
core/repo-hygiene — No committed build output, caches or stray root files.
core/review-gate — Changes pass review before landing.
core/spec-trace — Every test traces to a SPEC reference.
core/test-command-intact — Run the repo's own test commands unmodified.
core/test-kinds-by-scenario — Cover the scenario's required test kinds.
core/waivers-valid — Waivers are valid and unexpired.
core/workflow-gates — Mandatory gates stay in order.
core/write-confinement — Write only inside the repo root or the OS temp dir.
core/writes-within-plan — Write only files the plan allows.
ts/lint — The repo's linter passes on scope.
ts/no-phantom-import — Bare imports resolve to a declared dependency, a Node built-in, or a host-provided module (SPEC §6.4 EC-11).
ts/security-patterns — No dangerous JS patterns: eval, Function, exec with templates, innerHTML, document.write, dangerouslySetInnerHTML, rejectUnauthorized false, raw SQL.
ts/typecheck — The repo's tsc --noEmit passes.
Limits: defaults (softPercent 60, hardPercent 75, maxToolCalls 300, maxRepeats 3).
On block: apply Do instead, never retry a variation, escalate at the loop-breaker count.
Output: terse. codictator explain <id> names the rule; codictator context shows this file.
<!-- codictator:end -->

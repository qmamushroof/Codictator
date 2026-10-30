# 4.13 remediation

**[◀ 4.12 workflow](04-12-WORKFLOW.md)** · [SPEC index](../SPEC.md) · **[4.14 integrity ▶](04-14-INTEGRITY.md)**

Brownfield adoption and the step-by-step, never-breaking removal of everything unwanted (PRD §7.8, §11.11, §12 #13, #31). Codictator writes no feature code (PRD §12 #23): it performs mechanical steps itself and turns every other step into a task an agent executes under the normal workflow, gated per step.

## 4.13.1 Adoption sequence (`codictator init`)

1. Detect languages, harnesses, structure, bots, CI host; propose packs, profile, module map, smoke command; the human confirms.
2. Generate guardrails (§4.5, §4.15) and the manifest (§4.14): packs from `--pack` (each built-in at the engine version), helper tools from `--tool <role>=<command>@<pin>` (the role, binary and exact pin from the human's registry lookup), and the §3.3 module map when the repo is Codictator itself.
3. **Capture the baseline** (`.codictator/baseline.json`, §7.6) for every rule marked ratchet-capable in §5–§6, including stale-but-safe dependencies (`core/dep-latest-stable` keys `ecosystem:name`). On a greenfield repo with no findings the capture is the empty baseline; an existing baseline is never overwritten.
4. **Immediate floor remediation** of items needing no human decision (PRD §7.8): range → exact pin at the lockfile-resolved version (no version change); vulnerable or deprecated dependency with a fix in the same major. Each runs as a mechanical step (§4.13.4).
5. Build the remediation plan (§4.13.2) and run the first `verify`.

## 4.13.2 The plan

`.codictator/plan/remediation.json` (schema §7.13), committed; `codictator remediate plan` regenerates it deterministically from current findings, keeping finished steps. A step: `id` (`S-####`), `kind`, `target` (rule ids and metric keys), `scope` (paths or packages), `executor` (`codictator` or `agent`), `dependsOn`, `sizeBudget` (files, changed lines), `expectedDelta` (per target key), `status` (`pending`, `active`, `done`, `failed`, `split`, `blocked`), `attempts`, `children`, `taskId`.

| Kind | Generated from | Executor |
|---|---|---|
| `restore-green` | Build, tests or smoke failing on HEAD | agent |
| `floor-immediate` | §4.13.1 step 4 items; secrets in the working tree (remove; rotation is human) | codictator / agent |
| `safety-net` | Files that later steps touch with coverage below `core/coverage-floor` | agent (characterisation tests) |
| `dep-update` | Patch or minor behind latest stable; one package (or one release group, e.g. `@scope/*` published together) per step | codictator |
| `dep-major` | Major behind latest stable — a chain (§4.13.5) | agent |
| `dep-consolidate` | `core/dep-one-per-capability` duplicates: keep the platform or the package with most import sites, migrate the rest, remove | agent, final removal codictator |
| `arch-move` | Boundary, public-entry and cycle findings, grouped by module pair (strangler, §4.13.6) | agent |
| `debt-reduce` | Ratchet keys of code-health and test-integrity rules, one file per step | agent |
| `docs` | Doc findings, one doc set per step | agent |

## 4.13.3 Ordering

Steps are sorted by the tuple below, then topologically by `dependsOn`; the result is a pure function of findings, baseline, coverage and the import graph.

1. Kind rank: `restore-green` < `floor-immediate` < `safety-net` < `dep-update` < `dep-major` < `dep-consolidate` < `arch-move` < `debt-reduce` < `docs`. Nothing runs while a `restore-green` step is open, because every gate assumes a working app.
2. A step depends on the `safety-net` steps covering its scope.
3. Risk ascending: higher coverage of the scope first, then lower module fan-in first (leaves before hubs).
4. Within `debt-reduce`: family priority F2, F5, F4, F7, F6, F10; then largest baseline count first, so each step removes the most recorded debt.
5. Path, then package name, as the final tie-breaker.

## 4.13.4 Step execution and gates

`codictator remediate next` shows the first runnable step; `remediate run <id>` executes a `codictator` step or opens the task for an `agent` step (`files.allow` = step scope; type `refactor` or `chore`).

| Gate | Checks | Applies to |
|---|---|---|
| Pre | Clean work tree; build, full test suite and smoke command pass on the step base (result cached by tree id) | every step |
| Post | Build, full suite and smoke pass; `verify` finds no finding absent at the step base; every target key fell by at least `expectedDelta`; no ratchet key rose; diff within `sizeBudget` (default 10 files, 300 changed lines — `core/remediation-step-size`) | every step |

`config.commands.smoke` is an argv run with a timeout, exit 0 = pass. Without it, steps whose scope includes runtime code are `blocked: needs-smoke` and `init`/`status` say so. A `refactor` task created by a step owes no new acceptance tests: its behavioural proof is the safety-net coverage of its scope plus green suites before and after (§4.12.2).

A mechanical step runs on branch `codictator/remediate/<id>` from the base, commits its edit with a history entry, and opens a PR (or leaves the branch when no git host is configured). Steps never batch: one step, one PR.

## 4.13.5 Dependency majors

A `dep-major` is a chain of child steps, each separately gated:

1. **Coverage:** files importing the package reach the coverage floor (else a `safety-net` child first).
2. **Prerequisites:** runtime or toolchain bump required by the new major's `engines`; peer packages moved to versions compatible with both majors, one per step.
3. **Upgrade:** the version bump plus fixes confined to files importing the package (agent task); pack-listed codemods are Later (§1.6).
4. **Cleanup:** remove compatibility shims and deprecated-API usages flagged by type check or lint.

In a workspace whose lockfile permits divergence, step 3 splits per workspace package. The lag allowance keeps counting (`majorLagDays`); a vulnerable version has none (PRD §12 #15).

## 4.13.6 Architecture moves (strangler)

For each module pair with findings:

1. Add the needed exports to the target module's entry.
2. Migrate importers in batches of at most `batchFiles` (default 10) per step.
3. The step that removes the last deep import closes the pair.
 A cycle is broken by moving the shared piece into a `shared` module or by inverting the dependency through an interface owned by the depending module's `domain` layer; the end state (named edge absent) is the step's `expectedDelta`.

## 4.13.7 Rollback and split

On a failed post gate, the step branch is reset to its base and deleted; this applies only to Codictator's own `codictator/remediate/*` branches, never a user branch or the default branch. The step becomes `failed`, `attempts` + 1, and an event records the failing gate output (truncated to 4 KB). It is then split:

| Kind | Split |
|---|---|
| `dep-update` of a release group | One package per child |
| `dep-major` upgrade | Per workspace package, then per importing module |
| `arch-move` | Halve the batch |
| `debt-reduce`, `docs` | Per function or section when the enforcer reports regions, else unsplittable |

An unsplittable step, or one failing twice at minimal size, becomes `blocked` and escalates to the human (§4.12.5) with the gate output; its debt stays under the ratchet, so nothing gets worse meanwhile.

## 4.13.8 Pre-existing findings at L4 (§11 S12)

A **floor** finding present on the base branch blocks every PR (no mercy), except a PR that fixes it (PRD §12 #35). A fixing PR lowers the finding's count, to zero or by a plan step's `expectedDelta`, and introduces no new finding. Ratchet findings never block a PR that leaves them unchanged and untouched (§4.3.5).

## 4.13.9 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Tests already failing at install | Single `restore-green` step; all others wait |
| EC-2 | No smoke command | Runtime-affecting steps `blocked: needs-smoke` |
| EC-3 | Dirty work tree on `remediate run` | `CDX-E608`, nothing done |
| EC-4 | Mechanical upgrade passes tests but smoke fails | Rolled back, split or blocked |
| EC-5 | Post gate finds a new finding outside the step's scope | Fails the step (nothing else may get worse) |
| EC-6 | Step exceeds size budget | Fails; split before retry |
| EC-7 | Major requires newer Node than pinned | Toolchain prerequisite child step first |
| EC-8 | Vulnerable dep whose only fix is a major | Floor finding blocks other PRs; the `dep-major` chain's PRs are allowed by §4.13.8 |
| EC-9 | Plan regenerated after new findings | Finished steps kept; new steps inserted by the ordering; ids never reused |
| EC-10 | Two steps touch the same file | `dependsOn` serialises them in order |
| EC-11 | Human merges a step PR out of order | Next `remediate plan` re-checks targets; already-satisfied steps become `done` |
| EC-12 | Rollback requested on a user branch | Refused `CDX-E609` |
| EC-13 | Secret found in history but not in the tree | Reported in `status` with rotation advice; history rewrite left to the human; not a blocking finding |
| EC-14 | Duplicate capability where one side is the platform | Keeper is the platform; package migrated away and removed |
| EC-15 | Repo with no git remote | Steps stay as local branches; `status` lists them |

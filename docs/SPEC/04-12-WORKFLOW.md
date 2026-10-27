# 4.12 workflow

**[◀ 4.11 arch](04-11-ARCHITECTURE-GUARDS.md)** · [SPEC index](../SPEC.md) · **[4.13 remediation ▶](04-13-REMEDIATION.md)**

Phases with gates, task records, the review gate, the loop breaker, single- and multi-agent operation (PRD §7.6, §8 F9, F11, §8.3, §12 #6, #17, #26).

## 4.12.1 Tasks

A task is `.codictator/tasks/<id>.json` (schema §7.11), committed, created by `codictator task new --type <feature|fix|refactor|docs|deps|chore> --title …`. Ids are `T-####`, sequential per repo. A task binds to the current branch; a branch has at most one open task, which is the **active task** for every hook on that branch, including subagents. Agents change task state only through `codictator task …`, `test red|green` and `review …` commands; direct writes to task files are blocked (§4.14.3).

## 4.12.2 Phases and gates

| # | Phase | Writes allowed | Exit gate (evidence in the task record) | Mandatory |
|---|---|---|---|---|
| 1 | discovery | Spec docs | `spec` refs listed and resolving (§4.10.1); for `fix`: `diagnosis` (reproduction, root cause) | yes |
| 2 | planning | Tests, spec docs | `files.allow` globs; acceptance criteria; declared tests exist; required kinds covered (§4.10.3); red proof (§4.10.2) | yes |
| 3 | implementation | `files.allow` | — | yes |
| 4 | validation | `files.allow` | Green proof of declared tests; `codictator verify --staged` passes; any later write voids the proof | yes |
| 5 | review | none | Review gate (§4.12.4) | yes |
| 6 | record | `docs/HISTORY/*`, `docs/BUGS/*` | History entry staged (§4.9.3); for `fix`, the bug row updated (§4.9.4) | yes |
| 7 | integrate | none | Commit, push and PR via git hooks and CI; merge only on green required check | yes |

`codictator task phase next` advances only when the exit gate holds, else `CDX-E604` lists the missing evidence.

**Change classes** shorten the path by type; a change that touches code files is reclassified as code and owes every gate.

| Class | Path |
|---|---|
| `docs` | Skips the red and green proofs |
| `refactor` (behaviour-preserving) | Coverage gate instead of the red proof: touched files at or above `core/coverage-floor`, full suite green before and after. Owes no new acceptance test; may add tests but not modify existing ones, and modifying one reclassifies it as `feature` |
| `deps` (manifests and lockfiles only) | Skips discovery, planning, proofs and review |
| `chore` limited to manifest-owned files | Runs as `guardrail`, record phase only |

**Customisation** (`config.workflow.phases`): users insert phases (e.g. `security-review`, `qa`) at any position after discovery, each with an exit gate built from gate primitives (`command-passes`, `file-exists`, `review-round`, `human-ack`). The seven mandatory phases keep their relative order; removing or reordering one is `CDX-E105` (PRD §6.1).

## 4.12.3 Enforcement by layer

| Layer | Check (rule `core/workflow-gates`, `core/writes-within-plan`) |
|---|---|
| L0 | Injection shows phase, next gate and the command (§4.6.3) |
| L1 | A write is blocked when there is no active task, when the phase does not allow that file class, or when the path is outside `files.allow` (PRD §8.3); the message names the phase and the command to move on or amend the plan |
| L3 | `pre-commit`: active task in phase ≥ record; `commit-msg`: history entry (§4.9) |
| L4 | Every task touched in the PR has evidence for every gate of its class; red proofs re-run (§4.10.2) |

## 4.12.4 Review gate (F11)

| Step | Specification |
|---|---|
| Bind | The reviewed object is the staged index tree id (`git write-tree`); any change to the index makes the review stale |
| Reviewer | Runs as a fresh session (the `codictator-review` asset). Its session id must not appear in the task's `authorSessions` (sessions that wrote any task file) nor in any earlier round. Identity comes from the `tool.pre.shell` event the hook recorded for the `review submit` command (matched by argv hash within 10 s); with no L1 adapter, `--session` is required and the round is marked `identity: declared`, shown in the CI summary |
| Submit | `codictator review submit --task <id> --findings <file>`: findings `{ id, severity: blocker \| major \| minor \| nit, path, line, message }`; an empty list is a pass |
| Resolve | Blocker and major findings resolve only by a change (which forces a new round); minor and nit may be `wontfix` with a reason |
| Gate | Last round's tree id equals the staged tree, zero open blocker/major findings, all `integrityExceptions` acknowledged (§4.10.4) |
| Cap | `core/review-round-cap` rounds; reaching it escalates (§4.12.5) |
| Docs | `docs` class: one fresh round, same binding |

The gate never parses the review's prose (PRD §12 #26).

## 4.12.5 Loop breaker (`core/loop-breaker`)

Per active task (or per session with no task), Codictator counts consecutive blocks by the same rule with no intervening allow for that rule. At `maxRepeats` the next tool call is answered with an **escalation**: every tool call for the task is blocked, and the message tells the agent to stop and give the human a summary (rule, attempts, the conflict). The escalation is recorded in the task record and the event log. `codictator task ack <id> --note …` (human-only, §4.2.3) clears it. Review-round cap escalations use the same path. The floor never moves; only the attempt stops (PRD §7.1).

## 4.12.6 Multi-agent

Roles (`planner`, `implementer`, `reviewer`, `qa`) are recorded per session on `session.start`/`subagent.start` from the subagent or skill name (`codictator-review` → reviewer). Roles inform injection only; gates are the same for every role, and the reviewer constraint is freshness, not the label. Parallel work uses one branch per task; `.codictator/state/task.lock` serialises task-record writes on one machine, and on merge conflicts in a task record the later phase wins only if its gate evidence verifies.

## 4.12.7 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Write with no active task | Block with `codictator task new` instructions |
| EC-2 | Implementation write before red proof | Block |
| EC-3 | Write outside `files.allow` | Block; remediation: `codictator task amend --allow <glob>`, which returns the task to planning if new tests are needed |
| EC-4 | Write during review phase | Block; to change code, return to implementation (voids proofs and review) |
| EC-5 | Reviewer session is the author session | `review submit` refuses `CDX-E605` |
| EC-6 | Review submitted, then a file restaged | Gate fails: stale tree |
| EC-7 | Fourth consecutive block of `core/arch-boundaries` | Escalation; all task tool calls blocked until `task ack` |
| EC-8 | Agent runs `codictator task ack` | Blocked by shell guard; and `CDX-E107` if reached |
| EC-9 | Custom phase inserted before discovery | `CDX-E105` |
| EC-10 | Two open tasks on one branch | `CDX-E606`; `status` lists both |
| EC-11 | Docs-only change in a code task | Allowed; the task still owes code gates if code changed |
| EC-12 | Bot dependency PR | `deps` class; no task file required; CI-added history entry (§4.15.3) |
| EC-13 | Branch switched mid-session | Active task follows the branch on the next hook |
| EC-14 | Review findings file malformed | `CDX-E607`; round not recorded |

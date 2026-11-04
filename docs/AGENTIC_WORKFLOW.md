# Agentic Workflow

How an agent runs the seven mandatory phases of SPEC §4.12.2 on this repo. SPEC owns the phases, gates and evidence; this file owns how they are carried out here.

## Modes

Self-hosted since the [phase 10](ROADMAP/10-SELF-HOST.md) exit gate: task records, hooks and `codictator ci verify` enforce the gates. Evidence lives in the task record (SPEC §7.11), written only through SPEC §4.19.2 commands.

## Orchestration

The session the human talks to is the **orchestrator**. It splits task work into subtasks — one phase the task's type owes (SPEC §4.12.2), or one part of a large phase — and briefs a brand-new subagent per subtask. A finished subagent is never reused, and a subagent never re-delegates.

- Briefs are self-contained: subtask and roadmap step id, then SPEC references, file globs and acceptance criteria once discovery and planning return them. Facts only, never the transcript.
- The orchestrator never writes a tracked file, runs validation, reviews or commits. Its checkpoint ([Context and session hygiene](#context-and-session-hygiene)) is the one file it writes. Read-only subagents may run in parallel; writers follow [Multi-agent work](#multi-agent-work).
- The orchestrator relays open questions to the human and briefs the next subagent from the answers. Without subagents, it writes the checkpoint and brief, and the human opens a new session per subtask.
- The review subagent is briefed per [5. Review](#5-review) only (freshness is SPEC §4.12.4). When the harness shares the parent `sessionId` (SPEC §7), review runs in a new top-level session instead.

## Tasks and branches

- A task is one `codictator task new` record (ids `T-####`, SPEC §4.12.1); its type is one of SPEC §4.12.1. Branch: `<type>/<phase>-<slug>` (e.g. `feature/03-kernel-ports`); one open task per branch, nothing straight to `main`. A task too large for one session is split into steps; scope is never shrunk to fit. History entries name the task id in **Task:** (grammar SPEC §7.7).

## 1. Discovery

- Read the current roadmap phase leaf, the SPEC leaves its step cites, and [CONVENTIONS.md](CONVENTIONS.md); for a fix, [DEBUGGING.md](DEBUGGING.md) first. With `graphify-out/`, query the knowledge graph before any repo-wide search (`core/graph-before-scan`).
- Gate: the implemented SPEC references are listed and resolve (`core/spec-trace`); a fix also has its diagnosis. SPEC silent or self-contradictory: stop, fix SPEC in its own docs change first, or record the question in PRD §13.

## 2. Planning

- State the allowed file globs, acceptance criteria, and declared tests by full title; a missing test is written now and enters the ledger red (SPEC §10.7). Gate: every required test kind for the scenario is declared (`core/test-kinds-by-scenario`) with the red proof held (`codictator test red`, SPEC §4.10.2).

## 3. Implementation

- Write only inside the planned globs (`core/writes-within-plan`); follow [CONVENTIONS.md](CONVENTIONS.md). Each declared test leaves the ledger in the change that makes it pass (SPEC §10.7). A test is changed only when it contradicts SPEC; record that as an integrity exception (SPEC §4.10.4) for the reviewer.

## 4. Validation

Run every always-row of [VALIDATION.md](VALIDATION.md) plus each conditional row the change matches. Any write after validation voids it; run it again.

## 5. Review

- The reviewer is a fresh session that wrote no file of this task, in any harness: the `codictator-review` asset submitting through `codictator review submit` (SPEC §4.12.4). It reads only the staged diff, the task's SPEC references and [CONVENTIONS.md](CONVENTIONS.md). Findings use the shape of SPEC §7.16. Blocker and major findings return to validation and need a new round; minor and nit findings are fixed or closed as `wontfix` with a reason.
- The gate holds when the reviewed tree equals the staged tree with no blocker or major finding open; hitting `core/review-round-cap` escalates to the human. Docs-only changes get one fresh round with the same binding.

## 6. Record

- Prepend one entry directly under the title of `docs/HISTORY/<YYYY-MM-DD>.md` for the commit about to be made (SPEC §4.9.3, grammar SPEC §7.7); its subject equals the commit subject exactly. Write it after review, never earlier. **Why** gives the reason, not the diff; **What went wrong** names abandoned approaches and surprises; **Trade-offs** names what was given up; **Lessons** tells the next session what it cannot see in the code. A lesson that changes a rule goes into the owning doc in the same commit.
- Earlier entries are never edited (`core/history-append-only`). A fix commit also carries `Bug:` and updates its registry row ([DEBUGGING.md](DEBUGGING.md)).

## 7. Integrate

- Conventional commit subject per `core/conventional-commit` (scope: module name, `deps`, `docs` or `ci`); code and history entry are one commit. Push, open or update the PR, and merge only when the required check is green on all three OSes. Merge with a merge commit or a rebase, never a squash (SPEC §4.9.3, §11 S33). Never `--no-verify`, force-push a shared branch, or disable a workflow (`core/no-bypass`).

## Context and session hygiene

- Context bands and the tool-call limit are SPEC §5.1: at the soft band finish the current unit and checkpoint; at the hard band checkpoint and continue in a new session. Checkpoint with `codictator task checkpoint`; without subagents use `.codictator/state/resume.md` (SPEC §7.1).
- A subagent at its limit returns `CHECKPOINT: <summary>` instead of clearing. A return without its deliverable is a STALL: relaunch a continuation carrying the interim evidence; no phase waits on a missing verdict.
- After opening a PR, merge-watch: poll `gh pr view <n> --json mergeStateStatus` and `gh pr checks <n>` about every 4 minutes for up to about 2 hours. Merge with `--merge` only when CLEAN with all required checks passing; a skipped sweep is normal. Whoever observes CLEAN first merges; `gh pr merge` on an already-merged PR fails safe. An integrate/watch brief restates cadence, token scope and takeover verbatim. Never merge red, force-push, or bypass hooks (`core/no-bypass`).
- Never re-read an unchanged file range already in context (`core/read-dedupe`); load MCP servers and tools only when the task needs them. The same rule or test failing three consecutive times means stop and summarise for the human (`core/loop-breaker`).
- When stuck, the agent MAY use web search (if the harness offers it) to compare approaches. Never copy external code verbatim, add a dependency from it without the SPEC §2 change and registry lookup (SPEC §4.8.3), or name external repos or apps in tracked files, commits or PRs. SPEC overrides anything external.

## Resuming

Treat any summary as unverified. Read [AGENTS.md](../AGENTS.md), then `codictator context` (or `.codictator/state/resume.md` without subagents); check `git status`, `git log --oneline -10`, `git diff`, and `git ls-files --others --exclude-standard`; read the current phase leaf and brief the next subagent from its first unchecked step.

## Multi-agent work

Roles are SPEC §4.12.6. One branch per task; one agent writes to a branch at a time; a reviewer session never authored the task.

- Read-only subtasks parallelize freely (discovery, cross-branch reviews, independent questions, per-leg CI triage). Writers run in parallel only on disjoint file globs with separate branches/worktrees and a declared merge order ([Tasks and branches](#tasks-and-branches)).
- Shared choke files (`red-ledger.json`, `pack.json`, SPEC leaves, `HISTORY`, roadmap ticks) serialize: delist/edit only own titles, rebase before landing. Oversize plans live in gitignored `.codictator/state/plans/<step>.md`, never in `docs/`.
- The orchestrator keeps a READY QUEUE of unblocked tasks and keeps workers fanned out while a long wait blocks; idling while fan-out is possible is the default to correct. Suite runs serialize on one token: quiesce provably orphaned runners before starting yours, never kill an active holder's run.
- Never `git stash`/`pop` in a linked worktree (`refs/stash` is repo-global); commit first, then rebase.

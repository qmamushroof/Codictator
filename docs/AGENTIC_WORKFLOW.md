# Agentic Workflow

How an agent runs the seven mandatory phases of SPEC §4.12.2 on this repo. SPEC owns the phases, gates and evidence; this file owns how they are carried out here.

## Modes

| Mode | Applies | Gates enforced by |
|---|---|---|
| **Bootstrap** | Until the exit gate of [ROADMAP phase 10](ROADMAP/10-SELF-HOST.md) | CI running [VALIDATION.md](VALIDATION.md), the red ledger, the fresh-session reviewer, and this file |
| **Self-hosted** | From phase 10 on | Codictator itself: task records, hooks, git hooks and `codictator ci verify` |

Both modes owe the same evidence. Bootstrap keeps it in the pull request description under fixed headings (`Plan`, `Red proof`, `Validation`, `Review round n`). Self-hosted mode keeps it in the task record (SPEC §7.11), written only through the commands of SPEC §4.19.2.

## Orchestration

The session the human talks to is the **orchestrator**. It delegates all task work to fresh subagents, so each subagent context holds only its own subtask.

- A **subtask** is one phase the task's type owes (SPEC §4.12.2), or one part of a large phase. The orchestrator does all splitting.
- The orchestrator reads only what it needs to split and brief: the [Resuming](#resuming) steps, this file, [ROADMAP.md](ROADMAP.md), the current leaf and its how-to.
- It never writes a tracked file, runs validation, reviews or commits. Its own checkpoint ([Context and session hygiene](#context-and-session-hygiene)) is the one file it writes.
- Every subtask gets a brand-new subagent. A finished subagent is never reused for the next one.
- A brief is self-contained and carries everything known so far: the subtask and the roadmap step id, then the SPEC references, file globs and acceptance criteria once discovery and planning have returned them. The orchestrator passes facts, never its own transcript.
- A subagent does its subtask itself and never re-delegates. It returns files changed, evidence and open questions, or checkpoints per [Context and session hygiene](#context-and-session-hygiene).
- The orchestrator relays open questions to the human and briefs the next subagent from the answers.
- Read-only subagents may run in parallel; writers follow [Multi-agent work](#multi-agent-work).
- The review subagent is briefed per [Review](#5-review) only. Freshness is SPEC §4.12.4. When the harness gives subagents their parent's `sessionId` (SPEC §7), review runs in a new top-level session instead.
- In a harness without subagents, the orchestrator writes the checkpoint and the brief, and the human opens a new session for each subtask with them.

## Tasks and branches

- A task is one roadmap step in bootstrap mode, or one `codictator task new` record in self-hosted mode. Its type is one of SPEC §4.12.1.
- Branch name: `<type>/<phase>-<slug>`, for example `feature/03-kernel-ports`. One open task per branch; nothing is committed to `main` directly.
- A task too large for one session is split into steps; scope is never shrunk to fit.
- A bootstrap commit's history entry carries `Task: none` and names the roadmap step id in **Why**.

## 1. Discovery

- Read the current roadmap phase leaf, the SPEC leaves its step cites, and [CONVENTIONS.md](CONVENTIONS.md). For a fix, read [DEBUGGING.md](DEBUGGING.md) first.
- When `graphify-out/` exists, query the knowledge graph before any repo-wide search (`core/graph-before-scan`).
- Gate: the SPEC references the task implements are listed and resolve (`core/spec-trace`); a fix also has its diagnosis.
- SPEC silent or self-contradictory on the point? Stop. Fix SPEC in its own docs change first, or record the question in PRD §13. Code never settles it.

## 2. Planning

Planning commits the upfront guardrails of PRD §8.3 before any implementation.

- State the allowed file globs, the acceptance criteria, and the declared tests by full title.
- Declared tests normally already exist in the red ledger from phase 2. A missing one is written now and enters the ledger red (SPEC §10.7).
- Gate: every required test kind for the scenario is declared (`core/test-kinds-by-scenario`), and the red proof holds. In bootstrap mode the proof is a green `npm test` run on a commit where every declared test is a ledger entry; record that commit.

## 3. Implementation

- Write only inside the planned globs (`core/writes-within-plan`). Needing another file means returning to planning and saying why.
- Follow [CONVENTIONS.md](CONVENTIONS.md).
- Each declared test leaves the ledger in the change that makes it pass (SPEC §10.7).
- A test is changed only when it contradicts SPEC. Record that as an integrity exception (SPEC §4.10.4) for the reviewer to acknowledge.

## 4. Validation

Run every always-row of [VALIDATION.md](VALIDATION.md) and every conditional row the change matches. Any write after validation voids it; run it again.

## 5. Review

The review gate is SPEC §4.12.4.

- The reviewer is a fresh session that wrote no file of this task, in any harness. In self-hosted mode it is the `codictator-review` asset submitting through `codictator review submit`.
- It reads only the staged diff (`git diff --cached`), the task's SPEC references and [CONVENTIONS.md](CONVENTIONS.md). Nothing from the author's session is passed to it.
- Findings use the shape of SPEC §7.16. Bootstrap mode pastes them into the PR description as `Review round n`.
- Blocker and major findings are fixed by a change, which returns to validation and needs a new round. Minor and nit findings are fixed or closed as `wontfix` with a reason.
- The gate holds when the reviewed tree equals the staged tree and no blocker or major finding is open. Reaching `core/review-round-cap` escalates to the human.
- A docs-only change gets one fresh round with the same binding.

## 6. Record

- Prepend one entry directly under the title of `docs/HISTORY/<YYYY-MM-DD>.md` for the commit about to be made (SPEC §4.9.3). Grammar is SPEC §7.7; required fields per kind are SPEC §4.9.3; its subject equals the commit subject exactly.
- Write it after review, never earlier: an entry written before review describes the plan, not the change.
- **Why** gives the reason, not the diff. **What went wrong** names the abandoned approaches and surprises. **Trade-offs** names what was given up. **Lessons** tells the next session what it cannot see in the code.
- A lesson that changes a rule goes into the doc that owns the rule, in the same commit.
- Earlier entries are never edited (`core/history-append-only`). A fix commit also carries `Bug:` and updates its registry row ([DEBUGGING.md](DEBUGGING.md)).

## 7. Integrate

- Conventional commit subject per `core/conventional-commit`; the scope is a module name, `deps`, `docs` or `ci`.
- The code and its history entry are one commit. Push, open or update the PR, and merge only when the required check is green on all three OSes.
- Merge with a merge commit or a rebase, never a squash (SPEC §4.9.3, §11 S33).
- Never `--no-verify`, never force-push a shared branch, never disable a workflow (`core/no-bypass`).

## Context and session hygiene

- Context bands and the tool-call limit are SPEC §5.1. At the soft band, finish the current unit and checkpoint. At the hard band, checkpoint and continue in a new session.
- Bootstrap checkpoint: write `.codictator/state/resume.md` (git-ignored, the path SPEC §7.1 reserves) with task, branch, done, next and open questions. Self-hosted: `codictator task checkpoint`.
- A subagent at its limit returns `CHECKPOINT: <summary>` to its caller instead of clearing.
- A subagent returning without its deliverable — no verdict, no gate numbers, mid-gate yield — is a STALL, not completion. The orchestrator immediately relaunches a continuation subagent carrying the interim evidence; no phase waits on a missing verdict.
- After opening a PR, the task owner starts a merge-watch instead of handing the wait to the human: poll `gh pr view <n> --json mergeStateStatus` and `gh pr checks <n>` about every 4 minutes for up to about 2 hours, sleeping with shell `Start-Sleep` between polls. A wall-clock wait costs no tokens, unlike a background worker holding context for the same wait; the PR body records the watch (PR number, poll interval).
  - Merge only when the state is CLEAN with all required checks passing — a skipped sweep is normal, not red. Then merge with `--merge`, pull `main`, and continue the next phase ([Integrate](#7-integrate)).
  - On red, fix forward on the branch and re-watch; never merge red, never force-push, never bypass hooks (`core/no-bypass`).
- Never re-read an unchanged file range already in context (`core/read-dedupe`). Load MCP servers and tools only when the task needs them.
- The same rule or test failing three consecutive times (`core/loop-breaker`) means stop. Summarise the rule, the attempts and the conflict for the human instead of trying a variation.
- When stuck (2 failed attempts on one approach, or an unfamiliar problem with no in-repo precedent), the agent MAY use web search (if the harness offers it) to compare approaches, including open-source code.
- Guardrails: never copy external code verbatim (licenses; [CONVENTIONS.md](CONVENTIONS.md) determinism and style rules); never add or upgrade a dependency from it without the SPEC §2 change and registry lookup (SPEC §4.8.3); SPEC still overrides anything external.
- Never name external repos or apps in tracked files, commits, or PRs; keep sources in the subagent session report only, never in HISTORY.

## Resuming

After compaction or in a new session, treat any summary as unverified.

1. Read [AGENTS.md](../AGENTS.md), then `.codictator/state/resume.md` (bootstrap) or `codictator context` (self-hosted).
2. Check reality: `git status`, `git log --oneline -10`, `git diff`, and `git ls-files --others --exclude-standard`, because untracked files are work too.
3. Read the current phase leaf and brief the next subagent from its first unchecked step.

## Multi-agent work

Roles are SPEC §4.12.6. Parallel work uses one branch per task, and one agent writes to a branch at a time. A reviewer session is never one that authored the task.
- Parallelize read-only subtasks freely — discovery, reviews of different branches, independent code questions, per-leg CI triage — with as many focused agents as needed; zero coordination overhead (see [Orchestration](#orchestration)).
- Writers run in parallel only on disjoint file globs with separate branches/worktrees and a declared merge order (see [Tasks and branches](#tasks-and-branches)).
- Shared choke files (`red-ledger.json`, `pack.json`, SPEC leaves, `HISTORY`, roadmap ticks) serialize: delist/edit only own titles, rebase before landing; reviewers stay fresh per [5. Review](#5-review).
- Briefing overhead is not zero: each worker re-loads shared context, so briefs stay narrow — only the SPEC leaves and globs that worker needs (see [Orchestration](#orchestration)).
- With narrow briefs, disjoint globs, no shared edits and merge-order-free work, marginal cost per extra worker is ≈ its own task tokens; use as many focused workers as needed, bounded by harness limits (max concurrent sessions, CPU for parallel suites, disk per worktree).
- Every orchestrator turn re-scans for parallelizable work and keeps workers fanned out while blocked on a long wait (suite token, CI watch); idling sequential while fan-out is possible is the default to correct.
- Suite quiesce: full `npm test` runs are CPU-bound and serialize on one suite token. Before starting a suite, the holder quiesces stale runners — list `node` test processes (Id/CPU/StartTime) and kill only ones provably orphaned (command line references a removed worktree, or started before the current session's first suite with zero CPU growth across two samples 20s apart). Never kill while another holder is active unless the orphan proof holds. After a timeout-kill of your own suite, verify no children linger before yielding the token.
- Never `git stash`/`pop` in a linked worktree: `refs/stash` is shared repo-global, so a `stash pop` can cross-apply another branch's files mid-integrate. Commit first for rebases (commit, then rebase the commit); stash only solo with explicit-SHA apply.

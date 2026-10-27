# 8. Rule Families

**[◀ 7. Feature Areas](07-FEATURE-AREAS.md)** · [PRD index](../PRD.md) · **[9. Release Scope ▶](09-RELEASE-SCOPE.md)**

What Codictator enforces on a target repo, at product level. The SPEC owns individual rules, ids, thresholds and enforcers. Tier is per rule; the column gives each family's default posture. Layers are §7.1.

## 8.1 Catalogue

| Id | Family | Enforces | Why | Tier | Layers |
|---|---|---|---|---|---|
| **F1** | Context & token hygiene | Context budget bands and session length limits; harness auto-compaction configured where exposed; at the hard band, further prompts and tool calls are blocked until a checkpoint is committed and the session is cleared or restarted; the fresh session resumes from committed task state (started headless where the harness allows); read de-duplication; tools loaded only when needed; terse-output mode; knowledge-graph lookup before broad file scans | Cost and answer quality both degrade as context fills | Tunable bands, floor checkpoint | L0, L1 |
| **F2** | Security & secrets | No secrets in the repo or agent context; dangerous shell commands denied; writes confined to the repo; static security analysis; input-validation and injection patterns per language | One leaked key or unsafe command outweighs every other gain | Floor | L1, L3, L4 |
| **F3** | Dependencies | Exact pins; latest stable; no vulnerable or deprecated versions; one capability one package; license allowlist; versions come from a lookup, never recall (§7.5) | Agents write versions from training data, which is stale by construction | Floor; lag allowance tunable | L1, L3, L4, L5 |
| **F4** | ATDD & tests | Every behaviour change traces to a SPEC entry; failing acceptance and unit tests derived from it are written before implementation and cover its edge cases; integration, architecture, stress and load tests required when the change's scenario calls for them; coverage floor; every fix ships a regression test proven red first | Tests written after code mostly confirm the code, bugs included | Floor; coverage threshold tunable | L1, L3, L4 |
| **F5** | Test integrity | No deleted or loosened assertions, skipped tests, shrunk fixtures, grown allowlists or raised baselines to turn a check green without a recorded reason; every guard has a violating fixture | "Make the test pass" is the commonest way an agent buys a fake green | Floor | L1, L4 |
| **F6** | Solution size & code health | Reuse ladder (need it at all → exists here → platform → existing package → new package → write it); file, function and type size limits; complexity caps; dead code removal; duplication caps and no invented abstractions (P1, §9.1); a safety floor of guards never removed to shrink a change | Bloat costs reading, testing and tokens forever | Tunable limits within bounds | L1, L2, L4 |
| **F7** | Architecture | A declared profile per repo (default for applications: feature-based clean modular monolith); module boundaries and dependency direction checked by compiler or architecture tests; strict compiler settings; evolutionary-architecture fitness checks | Boundaries enforced by prose erode at the first shortcut | Profile chosen; boundaries floor | L1, L2, L4 |
| **F8** | Change history | An entry for every code commit (why, what went wrong, trade-offs, lessons), every doc change and every dependency change, however small; records append-only | The diff shows *what*; only a record keeps *why* and the abandoned paths | Floor | L3, L4 |
| **F9** | Workflow | Default phases: discovery → planning → implementation → validation → pre-commit review → record changes → commit, push, merge; each phase has an entry gate; customisable per §6.1 | Skipped phases are where bugs enter | Floor gates; order tunable | L0, L1, L3, L4 |
| **F10** | Documentation architecture | Router-plus-leaf layout; one folder level; file length and breadth limits for every file including Markdown; sentence and paragraph density ceilings; one fact one owner; no inline changelogs or counts about the corpus; valid cross-references; organisation of specs, PRDs, changelogs, history, agents and hooks | Docs are read on every session; every wasted word is paid for repeatedly | Tunable limits within bounds | L1, L3, L4 |
| **F11** | Pre-commit review | Every code change reviewed by a fresh session with no author context, bound to the exact diff, until zero open findings; at the review-round cap the loop breaker escalates to the human; doc changes get one fresh review; findings recorded (§12 #26) | An author reviewing its own work inherits its own blind spots | Floor | L3, L4 |
| **F12** | Commit & repo hygiene | Conventional commits; no `--no-verify`, force-push or history rewrite on shared branches; file placement and naming; no stray, generated or oversized files committed; branch protection required | History is the record every later session trusts | Floor | L1, L3, L4 |
| **F13** | CI/CD | Generated CI running the full verify on every push and PR; pinned CI actions; required checks; scheduled sweeps; ratchet report; performance budgets where declared | Everything local is bypassable; CI is not (§6 P6) | Floor | L4, L5 |
| **F14** | Agent assets | Required subagents, commands and skills present per harness — QA, code review, debugging, bug recording, docs audit; knowledge-graph (e.g. graphify) and token-saver (e.g. caveman) tooling installed where the harness supports them | Agents use the workflow they are given; missing tools mean improvised ones | Floor presence; set tunable | L0, L4 |
| **F15** | Debugging & defects | Diagnose-before-fix workflow; every defect recorded in a bug registry; defects found in passing filed in the same session; regression test per fix (with F4) | Unrecorded bugs recur and get re-diagnosed at full cost | Floor | L0, L3, L4 |
| **F16** | Guardrail integrity | Generated files match the manifest; no disabled hooks or workflows; custom rules pass the pack self-test (§6 P3); waivers valid and unexpired (§6 P2, §7.7) | A guard that can be quietly removed protects nothing | Floor | L1, L3, L4 |

## 8.2 Scenario-driven test requirements (F4)

Which test kinds a change owes depends on what it touches; the SPEC owns the classifier.

| Change touches | Additionally requires |
|---|---|
| Any behaviour | Acceptance test, unit tests with edge cases, written failing first |
| A boundary between modules or an external system | Integration test |
| Module structure or dependency direction | Architecture test |
| A request path, queue, loop over unbounded input, or declared hot path | Stress and load test with a budget |
| A bug fix | Regression test proven red on the unfixed code |

## 8.3 Upfront anti-hallucination guardrails

Before implementation, the planning phase must commit the guardrails the agent will be held to for that task: the failing tests, the acceptance criteria, and the files it may touch. Implementation cannot start until they exist (F9 gate); writes outside the declared files are blocked at L1 until the plan is amended; calls to APIs absent from the installed dependency versions fail the language pack's type check or import check.

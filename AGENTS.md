# Codictator: deterministic, cross-harness guardrail engine for AI coding agents

## Before anything else

1. Any change to this repo follows [docs/AGENTIC_WORKFLOW.md](docs/AGENTIC_WORKFLOW.md), all seven phases, in order.
2. The current build phase is the first leaf of [docs/ROADMAP.md](docs/ROADMAP.md) with an unchecked step; read only that leaf and its how-to.
3. Resuming after compaction or a new session: [docs/AGENTIC_WORKFLOW.md §Resuming](docs/AGENTIC_WORKFLOW.md#resuming) before acting on any summary.

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
| Toolchain, OpenCode with the Meta Model API, VS Code | [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) |
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

Floor rules:
core/context-soft-band — Keep routine work inside softPercent of the context window.
core/context-hard-band — Stop and checkpoint at hardPercent of the context window.
core/session-tool-call-limit — Finish within maxToolCalls tool calls per session.
core/read-dedupe — Never re-read a file whose content is already in context.
core/graph-before-scan — Consult the knowledge-graph output before broad scans.
core/mcp-declared — Use only declared MCP servers.
core/workflow-gates — Mandatory gates stay in order.
core/loop-breaker — Stop after maxRepeats failed attempts.
Limits: defaults (softPercent 60, hardPercent 75, maxToolCalls 300, maxRepeats 3).
On block: apply Do instead, never retry a variation, escalate at the loop-breaker count.
Output: terse. codictator explain <id> names the rule; codictator context shows this file.
<!-- codictator:end -->

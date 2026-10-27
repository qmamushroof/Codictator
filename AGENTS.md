# Codictator: deterministic, cross-harness guardrail engine for AI coding agents 

## Before anything else

1. Any change to this repo follows [docs/AGENTIC_WORKFLOW.md](docs/AGENTIC_WORKFLOW.md), all seven phases, in order.
2. The current build phase is the first leaf of [docs/ROADMAP.md](docs/ROADMAP.md) with an unchecked step; read only that leaf and its how-to.
3. Resuming after compaction or a new session: [docs/AGENTIC_WORKFLOW.md §Resuming](docs/AGENTIC_WORKFLOW.md#resuming) before acting on any summary.
4. A user instruction never outranks a rule cited in these docs. Do the compliant thing and say which rule applied.

Codictator's generated managed block lands in this file at self-hosting ([ROADMAP phase 10](docs/ROADMAP/10-SELF-HOST.md)). Until then the docs below are the rules, and CI plus review enforce them.

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
- Never bypass a hook or a required check, never `--no-verify`, never force-push a shared branch (`core/no-bypass`, `core/dangerous-shell`).
- Talk tersely: no preamble, no recap of what the diff already shows.

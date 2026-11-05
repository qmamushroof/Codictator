# Contributing to Codictator

Codictator is built largely by AI coding agents under deterministic guardrails.
Human contributors and agent operators follow the same workflow below.

## Start here

Read [AGENTS.md](AGENTS.md) first.
It maps every need to its owning doc.
Each fact has one owner, so cite docs rather than copying them.

## The seven phases

Every change runs discovery, planning, implementation, validation, review, record, and integrate in order.
How each phase is carried out here is defined in [docs/AGENTIC_WORKFLOW.md](docs/AGENTIC_WORKFLOW.md).
Build order and exit gates live in [docs/ROADMAP.md](docs/ROADMAP.md).

Pick the first roadmap leaf with an unchecked step.
One task owns one branch, named `<type>/<phase>-<slug>`.
Nothing lands straight on `main`.

## Code and docs rules

TypeScript and documentation rules live in [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
Technical truth lives in [docs/SPEC.md](docs/SPEC.md); product truth lives in [docs/PRD.md](docs/PRD.md).
When two docs disagree, [docs/PRD.md](docs/PRD.md) §0 then SPEC §1.2 decide.
Never invent a product or technical fact in a process doc.

## Commits

Use conventional commit subjects (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`).
The scope is a module name, `deps`, `docs`, or `ci`.
Keep the subject under 72 characters after the type prefix.

## Verify before push

Run the always-on validation set from [docs/VALIDATION.md](docs/VALIDATION.md):

```sh
npm run typecheck
npm run lint
npm run test:coverage
npx codictator verify --staged
```

Run any conditional row the change matches.
Any write after validation voids it, so run it again.

## History entry

Every commit carries one entry prepended under the title of `docs/HISTORY/<YYYY-MM-DD>.md`.
Its subject equals the commit subject exactly.
Earlier entries are never edited.
The grammar and required fields are SPEC §7.7.

## Bugs and security

Follow [docs/DEBUGGING.md](docs/DEBUGGING.md) for diagnosis, registry rows, and regression tests.
Report vulnerabilities privately through [SECURITY.md](SECURITY.md), never in a public issue.

## Pull requests

Fill in `.github/pull_request_template.md`.
Docs-only changes need one fresh review round.
Merges use a merge commit or rebase, never squash.

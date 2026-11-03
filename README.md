# Codictator

**Code + Dictator.** A guardrail engine for repositories built by AI coding agents. Whatever the prompt says, only minimal, secure, tested, documented and well-architected changes land, and tokens are not wasted getting there.

Rules files only ask. Codictator turns each rule into something that runs: context injected where the agent reads it, harness hooks that block a bad tool call before it lands, git hooks, CI checks and scheduled sweeps. Asked for a bad outcome, the agent is steered to the compliant one and told which rule applied. Nothing is hidden.

> **Status: 0.1.3 published on npm, the VS Code Marketplace, and Open VSX.** Packages `codictator` and `codictator-vscode` are at 0.1.3 ([ROADMAP phase 13](docs/ROADMAP/13-RELEASE.md) green). Install from the registries below; source builds remain an alternative. Scope: [PRD §9](docs/PRD/09-RELEASE-SCOPE.md).

## What it enforces

Security and secrets, exact and current dependencies, SPEC-driven tests written failing first, test integrity, file and function size, architecture boundaries, change history, workflow gates with a fresh-session review, documentation layout, CI, and context and token hygiene. The full catalogue is [PRD §8](docs/PRD/08-RULE-FAMILIES.md); every rule id, default and bound is [SPEC §5](docs/SPEC/05-CORE-RULES.md) and [SPEC §6](docs/SPEC/06-LANGUAGE-PACKS.md).

Floor rules have no waiver and no off switch. Tunable rules can be tightened freely and loosened only within pack-owned bounds, with a reason and an expiry.

## Harnesses and languages

| | First release | Later (P1) |
|---|---|---|
| Harnesses | Muse Code (best-supported; hook I/O unverified, needs trusted folder), OpenCode (context inject partial, session events observe-only, 2.x unsupported), Claude Code, GitHub Copilot (timeouts fail open), Codex CLI (project hooks ignored in git worktrees), plus Universal via `AGENTS.md`, git hooks and CI (L1 none) | Cursor (shell events only, no usage data), Gemini CLI (compaction unverified, needs trusted folder) |
| Languages | TypeScript / JavaScript, full including npm enforcement; language-agnostic rules apply to any repo | .NET, Python (P1) |
| Optional LLM features | Meta Muse models suggested by default; any OpenAI- or Anthropic-compatible provider, or a local model | — |

What each harness can and cannot enforce is declared, never claimed: [SPEC §4.5](docs/SPEC/04-05-ADAPTERS.md).

## Install

> Install from the registries first and use source only as an alternative: `codictator` is on npm, and the extension is on the VS Code Marketplace and Open VSX ([phase 13](docs/ROADMAP/13-RELEASE.md) green).

Requires Node.js 24 LTS or newer in every repo, whatever its language.

Alternative — from source:

```sh
git clone <repo-url> codictator && cd codictator
npm ci --ignore-scripts
npm run build
```

The install path is `npm install --save-dev --save-exact codictator` followed by `npx codictator init` on each repo.

The VS Code extension `codictator.codictator-vscode` ships on the VS Code Marketplace and Open VSX with the release. It shows live what is enforced, how the agent is steered, violations and the timeline. It runs the engine pinned in your repo.

## Principles

Deterministic verdicts, no LLM in any gate · local and private, no telemetry · fail closed · CI is the source of truth · every block names the compliant alternative · Windows, macOS and Linux behave identically. Details: [PRD §6](docs/PRD/06-PRODUCT-PRINCIPLES.md).

## Contributing

Codictator is built by agents under its own rules. Start at [AGENTS.md](AGENTS.md); local setup is [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

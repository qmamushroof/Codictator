# Codictator

**Code + Dictator.** A guardrail engine for repositories built by AI coding agents. Whatever the prompt says, only minimal, secure, tested, documented and well-architected changes land, and tokens are not wasted getting there.

Rules files only ask. Codictator turns each rule into something that runs: context injected where the agent reads it, harness hooks that block a bad tool call before it lands, git hooks, CI checks and scheduled sweeps. Asked for a bad outcome, the agent is steered to the compliant one and told which rule applied. Nothing is hidden.

> **Status: pre-release.** Product and technical specifications are complete; implementation follows the [roadmap](docs/ROADMAP.md). Nothing is published to npm or the extension marketplaces yet.

## What it enforces

Security and secrets, exact and current dependencies, SPEC-driven tests written failing first, test integrity, file and function size, architecture boundaries, change history, workflow gates with a fresh-session review, documentation layout, CI, and context and token hygiene. The full catalogue is [PRD §8](docs/PRD/08-RULE-FAMILIES.md); every rule id, default and bound is [SPEC §5](docs/SPEC/05-CORE-RULES.md) and [SPEC §6](docs/SPEC/06-LANGUAGE-PACKS.md).

Floor rules have no waiver and no off switch. Tunable rules can be tightened freely and loosened only within pack-owned bounds, with a reason and an expiry.

## Harnesses and languages

| | First release | Later in the first release |
|---|---|---|
| Harnesses | Muse Code (best-supported), OpenCode, Claude Code, GitHub Copilot, Codex CLI, plus any harness through `AGENTS.md`, git hooks and CI | Cursor, Gemini CLI |
| Languages | TypeScript / JavaScript; language-agnostic rules apply to any repo | .NET, Python |
| Optional LLM features | Meta Muse models suggested by default; any OpenAI- or Anthropic-compatible provider, or a local model | — |

What each harness can and cannot enforce is declared, never claimed: [SPEC §4.5](docs/SPEC/04-05-ADAPTERS.md).

## Install (once released)

Requires Node.js 24 LTS or newer in every repo, whatever its language.

```sh
npm install --save-dev --save-exact codictator
npx codictator init
```

The VS Code extension `codictator.codictator-vscode` (VS Code Marketplace and Open VSX) shows live what is enforced, how the agent is steered, violations and the timeline. It runs the engine pinned in your repo.

## Principles

Deterministic verdicts, no LLM in any gate · local and private, no telemetry · fail closed · CI is the source of truth · every block names the compliant alternative · Windows, macOS and Linux behave identically. Details: [PRD §6](docs/PRD/06-PRODUCT-PRINCIPLES.md).

## Contributing

Codictator is built by agents under its own rules. Start at [AGENTS.md](AGENTS.md); local setup is [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

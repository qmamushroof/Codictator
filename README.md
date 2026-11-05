# Codictator

**Code + Dictator.** A guardrail engine for repositories built by AI coding agents. Whatever the prompt says, only minimal, secure, tested, documented and well-architected changes land, and tokens are not wasted getting there. Rules files only ask — Codictator turns each rule into something that runs: context injected where the agent reads it, harness hooks that block a bad tool call before it lands, git hooks, CI checks and scheduled sweeps. Asked for a bad outcome, the agent is steered to the compliant one and told which rule applied. Nothing is hidden.

> **Status: 0.2.4 published on npm, the VS Code Marketplace, and Open VSX.** Packages `codictator` and `codictator-vscode` are at 0.2.4 ([ROADMAP phase 13](docs/ROADMAP/13-RELEASE.md) green). Install from the registries below; source builds remain an alternative. Scope: [PRD §9](docs/PRD/09-RELEASE-SCOPE.md).

## What it enforces

Security and secrets, exact and current dependencies, SPEC-driven tests written failing first, test integrity, file and function size, architecture boundaries, change history, workflow gates with a fresh-session review, documentation layout, CI, and context and token hygiene. The full catalogue is [PRD §8](docs/PRD/08-RULE-FAMILIES.md); every rule id, default and bound is [SPEC §5](docs/SPEC/05-CORE-RULES.md) and [SPEC §6](docs/SPEC/06-LANGUAGE-PACKS.md). Floor rules have no waiver and no off switch. Tunable rules can be tightened freely and loosened only within pack-owned bounds, with a reason and an expiry.

## Harnesses and languages

- **First release (P0):** Muse Code (best-supported), OpenCode, Claude Code, GitHub Copilot, Codex CLI, plus Universal via `AGENTS.md`, git hooks and CI; TypeScript / JavaScript, full including npm enforcement, with language-agnostic rules applying to any repo; Meta Muse models suggested by default, any OpenAI- or Anthropic-compatible provider, or a local model.
- **Later (P1):** Cursor, Gemini CLI; .NET, Python. What each harness can and cannot enforce is declared, never claimed: [SPEC §4.5](docs/SPEC/04-05-ADAPTERS.md).

## Install

> One command does everything — `npx codictator setup` ([SPEC §4.19.6](docs/SPEC/04-19-CLI.md)). Run it yourself: `setup` is human-only and refuses under agent control (`CDX-E107`). Requires Node.js 24 LTS or newer and a git repo ([SPEC §4.19.4](docs/SPEC/04-19-CLI.md)).

`setup` runs adoption end to end — guardrails, engine install, git hooks, a first evaluation, then the extension handoff (`code --install-extension codictator.codictator-vscode`). Flags mirror `init` (`--harness`, `--profile`, `--pack`, `--tool`, `--repair`); without `--pack` you get core rules only, and `--repair --pack <name>` adds a language pack later. Prefer the steps separately? `npm install --save-dev --save-exact codictator`, then `npx codictator init`, `npm ci`, `npx codictator install-hooks` (with `.gitignore` per [SPEC §7.1](docs/SPEC/07-FILES-AND-FORMATS.md)); contributors build from source per [LOCAL_SETUP](docs/LOCAL_SETUP.md).

## Principles

Deterministic verdicts, no LLM in any gate · local and private, no telemetry · fail closed · CI is the source of truth · every block names the compliant alternative · Windows, macOS and Linux behave identically. Details: [PRD §6](docs/PRD/06-PRODUCT-PRINCIPLES.md).

## Contributing and license

Codictator is built by agents under its own rules. Start at [AGENTS.md](AGENTS.md); local setup is [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Security reports: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).

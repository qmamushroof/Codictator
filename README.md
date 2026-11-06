<img src="packages/vscode/resources/codictator-128.png" width="72" alt="Codictator logo" />

# Codictator

**Code + Dictator.** A guardrail engine for repositories built by AI coding agents. Whatever the prompt says, only minimal, secure, tested, documented and well-architected changes land, and tokens are not wasted getting there.

Rules files only ask — Codictator turns each rule into something that runs: context injected where the agent reads it, harness hooks that block a bad tool call before it lands, git hooks, CI checks and scheduled sweeps.

Asked for a bad outcome, the agent is steered to the compliant one and told which rule applied. Nothing is hidden.

> **Status: 0.2.6 published on npm, the VS Code Marketplace, and Open VSX.** Packages `codictator` and `codictator-vscode` are at 0.2.6 ([ROADMAP phase 13](docs/ROADMAP/13-RELEASE.md) green).
>
> Install from the registries below; source builds remain an alternative. Scope: [PRD §9](docs/PRD/09-RELEASE-SCOPE.md).

## What it enforces

- Security and secrets; exact and current dependencies.
- SPEC-driven tests, written failing first, with test integrity.
- File and function size limits; architecture boundaries and change history.
- Workflow gates with a fresh-session review.
- Documentation layout, CI, and context and token hygiene.
- Floor rules have no waiver and no off switch. Tunable rules tighten freely and loosen only within pack-owned bounds, with a reason and an expiry.
- Full catalogue: [PRD §8](docs/PRD/08-RULE-FAMILIES.md). Every rule id, default and bound: [SPEC §5](docs/SPEC/05-CORE-RULES.md) and [SPEC §6](docs/SPEC/06-LANGUAGE-PACKS.md).

## Harnesses and languages

- Harnesses: Muse Code (best-supported), OpenCode, Claude Code, GitHub Copilot, Codex CLI, Cursor, Gemini CLI, plus Universal via `AGENTS.md`, git hooks and CI.
- Languages: TypeScript/JavaScript with full npm enforcement, and Python with pack rules, extractor and PyPI enforcement. Language-agnostic rules apply to any repo. Planned next: .NET.
- Models: Meta Muse models suggested by default, any OpenAI- or Anthropic-compatible provider, or a local model. What each harness can and cannot enforce is declared, never claimed: [SPEC §4.5](docs/SPEC/04-05-ADAPTERS.md).

## Install

One command does everything ([SPEC §4.19.6](docs/SPEC/04-19-CLI.md)):

```sh
npx codictator setup
```

Run it yourself: `setup` is human-only and refuses under agent control (`CDX-E107`). Requires Node.js 24 LTS or newer and a git repo ([SPEC §4.19.4](docs/SPEC/04-19-CLI.md)).

`setup` runs adoption end to end — guardrails, engine install, git hooks, a first evaluation, then the extension handoff (`code --install-extension codictator.codictator-vscode`). Flags mirror `init` (`--harness`, `--profile`, `--pack`, `--tool`, `--repair`); without `--pack` you get core rules only, and `--repair --pack <name>` adds a language pack later.

Prefer the steps separately?

```sh
npm install --save-dev --save-exact codictator
npx codictator init
npm ci
npx codictator install-hooks
```

With `.gitignore` per [SPEC §7.1](docs/SPEC/07-FILES-AND-FORMATS.md); contributors build from source per [LOCAL_SETUP](docs/LOCAL_SETUP.md).

## Principles

- Deterministic verdicts, no LLM in any gate.
- Local and private, no telemetry.
- Fail closed.
- CI is the source of truth.
- Every block names the compliant alternative.
- Windows, macOS and Linux behave identically ([PRD §6](docs/PRD/06-PRODUCT-PRINCIPLES.md)).

## Contributing and license

Codictator is built by agents under its own rules. Start at [AGENTS.md](AGENTS.md); local setup is [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Security reports: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).

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

> One command does everything ([SPEC §4.19.6](docs/SPEC/04-19-CLI.md)). Run it yourself: `setup` is human-only and refuses under agent control (`CDX-E107`).

Requires Node.js 24 LTS or newer and a git repo, whatever its language ([SPEC §4.19.4](docs/SPEC/04-19-CLI.md)).

```sh
npx codictator setup
```

`setup` runs adoption end to end: guardrails (`setup: guardrails written from the init path`), engine install (`setup: npm ci passed in ...`), git hooks (`setup: hooks installed`), a first evaluation (`verify: pass (...)`), then the extension handoff (`setup complete: ...`, with `code --install-extension codictator.codictator-vscode`). Its flags mirror `init` (`--harness`, `--profile`, `--pack`, `--tool`, `--repair`); without `--pack` you get core rules only, and setup prints the exact line to add a language pack (`npx codictator setup --repair --pack typescript`).

Prefer the steps separately, or building from source? The registry sequence is `npm install --save-dev --save-exact codictator`, then `npx codictator init`, `npm ci`, `npx codictator install-hooks` (with `.gitignore` per [SPEC §7.1](docs/SPEC/07-FILES-AND-FORMATS.md)); contributors build from source per [LOCAL_SETUP](docs/LOCAL_SETUP.md).

## Principles

Deterministic verdicts, no LLM in any gate · local and private, no telemetry · fail closed · CI is the source of truth · every block names the compliant alternative · Windows, macOS and Linux behave identically. Details: [PRD §6](docs/PRD/06-PRODUCT-PRINCIPLES.md).

## Contributing

Codictator is built by agents under its own rules. Start at [AGENTS.md](AGENTS.md); local setup is [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

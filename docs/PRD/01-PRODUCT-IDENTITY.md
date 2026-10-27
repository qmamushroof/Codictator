# 1. Product Identity

**[◀ 0. Document Map](00-DOCUMENT-MAP.md)** · [PRD index](../PRD.md) · **[2. Problem ▶](02-PROBLEM.md)**

- **Name:** Codictator — *Code* + *Dictator*. The name states the stance: the rules are not negotiable by prompt.
- **One sentence:** Codictator installs a deterministic, cross-harness guardrail system into a repository so that AI coding agents — and the people prompting them — can only land minimal, secure, tested, documented, well-architected code with the fewest tokens spent.
- **Form:** a TypeScript CLI/engine on npm, plus a VS Code extension that shows live what is being enforced and why (§12 #2). MIT-licensed, free and open source (§12 #27).
- **Meta-first:** Meta's Muse Code is the best-supported harness, and Meta's Muse models are the default suggested provider for Codictator's optional LLM features; every other harness and model still works (§12 #30).

## 1.1 Pitch

Rules files only *ask* an agent to behave; agents forget them after compaction, reinterpret them under pressure, and obey a user who asks for the opposite. Codictator turns every rule into something that *runs*: context injected where the agent reads it, hooks that block a bad tool call before it lands, git hooks, CI checks, and continuous sweeps. When a prompt demands a bad outcome, the agent is steered to the compliant one and told why. Nothing is hidden; nothing is softened.

## 1.2 Vision and mission

| | |
|---|---|
| **Vision** | Agent-written software that is better than hand-written software by default, because quality is enforced by machinery rather than requested by prose. |
| **Mission** | Make every good-engineering rule a repo adopts *deterministically enforced* across every coding harness, while keeping token spend at its minimum and every decision transparent. |

## 1.3 What makes it defensible

1. **Coverage, not one concern.** Security, tests, architecture, dependencies, docs, history, workflow and token hygiene enforced by one engine with one rule model; competitors each own one slice (§4).
2. **A floor no prompt moves.** Floor rules have no waiver and no off switch inside the product (§6 P2).
3. **Steer, not just block.** Every block carries the compliant alternative, so the agent converges instead of looping (§6 P4).
4. **Harness-neutral.** One rule set, rendered into each harness's native hooks and context files, with CI as the backstop for any harness (§7.3).

## 1.4 Core terms

| Term | Meaning |
|---|---|
| **Target repo** | A repository Codictator is installed into. |
| **Harness** | An AI coding tool that runs agents in the repo — Muse Code, Claude Code, Codex CLI, Copilot, Cursor, Gemini CLI, OpenCode and similar. |
| **Rule** | A decidable statement with a reason, a tier, a remediation and at least one enforcer. |
| **Tier** | `floor` (non-negotiable) or `tunable` (thresholds adjustable within bounds) — §6 P2. |
| **Enforcer** | A deterministic check bound to an enforcement layer (§7.1). |
| **Pack** | A versioned bundle of rules, enforcers, templates and generated agent assets for a concern or language. |
| **Adapter** | The component that renders rules into one harness's native configuration. |
| **Guardrail** | The installed result: the context files, hooks, workflows and checks Codictator generates into a target repo. |
| **Waiver** | A recorded, expiring exception to a tunable rule. Floor rules have none. |
| **Ratchet** | A recorded debt baseline that may fall, never rise. |

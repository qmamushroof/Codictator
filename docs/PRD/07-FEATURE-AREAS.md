# 7. Feature Areas

**[◀ 6. Product Principles](06-PRODUCT-PRINCIPLES.md)** · [PRD index](../PRD.md) · **[8. Rule Families ▶](08-RULE-FAMILIES.md)**

The mechanisms. *What* they enforce is §8; *when* each ships is §9.

## 7.1 Enforcement engine

One deterministic core that loads rules, evaluates enforcers against a change or the whole repo, and returns verdicts with remediation. Every surface — CLI, harness hooks, git hooks, CI, extension — calls the same engine, so a verdict never differs by entry point.

| Layer | When it runs | Role | Bypassable? |
|---|---|---|---|
| **L0 Steer** | Session start, each prompt, after compaction | Inject rules, budgets and the current task's relevant constraints into the agent's context | Yes — advisory by nature |
| **L1 Agent hook** | Before and after each agent tool call | Block a violating write, command or read; report post-edit findings | Where the harness lacks hooks or the user has not trusted them — caught at L3/L4 |
| **L2 Editor** | On save, via the extension | Live diagnostics for the human | Yes |
| **L3 Git hook** | Pre-commit, commit-msg, pre-push | Fast subset of checks before history is written | Yes, by `--no-verify` — caught at L4 |
| **L4 CI** | Every push and pull request | Full verify plus guardrail integrity; the merge gate | Only by visible admin action |
| **L5 Scheduled** | Periodic CI job | Advisory and freshness sweeps, ratchet reports, upgrade changes | — |

**Fail closed.** An enforcer that errors, times out or cannot reach required data blocks with an explanation; it never passes by default.

**Loop breaker.** When the same rule blocks the same agent repeatedly in one task, Codictator stops the attempt, summarises the conflict and asks the human. This caps token burn without lowering the floor.

## 7.2 Rule packs

| Pack kind | Contents |
|---|---|
| **Core** (language-agnostic) | Every §8 family that needs no language knowledge |
| **TypeScript / JavaScript** | Compiler strictness, lint, architecture boundaries, test runners, npm dependency checks |
| **.NET** | Analyzer and build strictness, architecture tests, NuGet checks |
| **Python** | Type checking, lint, architecture contracts, PyPI checks |
| **Custom** | User- or generator-authored rules (§7.9) |

A pack is versioned, declares its rules with tier, bounds, enforcers and fixtures, and passes its own self-test before it can be enabled (§6 P3). Packs compose; a repo with several languages loads several packs.

## 7.3 Harness adapters

Each adapter renders the active rule set into one harness's native form: context file, hooks, permissions, subagents, commands and skills.

Targets, in priority order (release split in §9.1): **Muse Code** (best-supported, §12 #30), **OpenCode** (Codictator's own dogfooding harness with Meta models, §12 #21), Universal, Claude Code, GitHub Copilot (VS Code and CLI), Codex CLI, Cursor, Gemini CLI. Universal is `AGENTS.md` + git hooks + CI and covers any harness.

**Capability honesty.** Each adapter declares which layers and controls its harness supports. Where a harness lacks a control — e.g. no pre-tool hook, or no way to force a context clear — Codictator says so in the CLI and extension and relies on the next layer down, never claiming enforcement it cannot do. Harnesses that run project hooks only after the user trusts the folder (Muse Code, Codex CLI) show L1 as inactive until trusted.

**Generated files are owned.** Codictator regenerates them deterministically; hand edits are detected as drift and fail verify (§7.7).

## 7.4 Steering

L0 is how Codictator makes the agent do the right thing instead of merely refusing:

- **Precedence statement:** the injected context states that repository rules outrank any user instruction, and that a conflicting instruction is to be satisfied the compliant way, with the user told why.
- **Scoped injection:** only the rules relevant to the files and phase in play are injected, within the token budget (§6 P10).
- **Remediation on block:** every L1 block returns the compliant alternative as agent-readable text (§6 P4).
- **Post-compaction recovery:** after compaction or a new session, the current task state and active constraints are re-injected from committed records, not from the summary.

## 7.5 Dependency enforcement

| Aspect | Behaviour |
|---|---|
| **Source of truth** | Package registries and advisory databases, queried live; never an LLM or training data (§12 #3) |
| **"Latest stable"** | Newest non-prerelease version, past a minimum release age, with no known advisory, compatible with the declared runtime (§12 #14) |
| **Vulnerable or deprecated** | Floor: blocks at L1, L3 and L4. Remediation is the upgrade path |
| **Behind latest stable** | The upgrade change comes from the repo's Renovate or Dependabot via generated config, or from Codictator's own upgrade PR when neither is present (§12 #28); it passes the full workflow; staleness past the tunable lag allowance blocks (§12 #15) |
| **Exact pins** | Every manifest entry, toolchain, CI action and image is exactly pinned; ranges are refused |
| **One capability, one package** | A second package for a capability already present is refused |
| **New package** | Allowed only after the reuse ladder (§8 F6) and with a recorded reason |
| **Offline** | Uses the last cached registry snapshot and says so; an absent snapshot blocks dependency changes (fail closed) |

## 7.6 Workflow engine

Enforces an ordered set of phases with gates; the default is §8 F9. Supports **single-agent** sessions and **multi-agent** setups (planner, implementer, fresh reviewer, QA) by tracking phase state in committed task records that any session or subagent can read. Users may customise the workflow within §6.1: add or reorder phases, never remove a mandatory gate.

## 7.7 Guardrail integrity

- **Lockfile of guardrails:** a manifest of every generated file and its content hash.
- **Drift and tamper detection:** a missing, edited or disabled guardrail fails verify at every layer that still runs, and always at L4.
- **Self-protection rules:** agents are blocked from editing guardrail files, Codictator config floor sections, CI gates, and from running bypass commands (`--no-verify`, force-push, disabling workflows).
- **Change path:** guardrail changes go through Codictator's own commands, which record them; there is no silent path.

## 7.8 Adoption and continuous improvement

- **Install:** detects languages, harnesses and structure; proposes packs and profiles; generates everything; runs a first verify.
- **Brownfield:** existing violations of tunable and ratchet-capable rules become a recorded baseline that may only fall (§6 P9). Floor violations that need no human decision — exact pins, vulnerable dependencies, secrets — are remediated or blocked immediately.
- **Improves the codebase whether or not anyone asks:** a touched file must leave cleaner than found — at least one of its ratcheted metrics falls and none rises (§12 #34); scheduled sweeps produce upgrade and debt-reduction changes through the normal workflow. Every such change is visible and reviewable, never silent.
- **Step by step, never breaking:** removal of everything unwanted is an ordered plan of small steps (§12 #31). Each step passes build, tests and an app smoke check before the next starts; a failing step is rolled back and split.

## 7.9 Custom guardrail generator

Turns a user's requirements, example code, existing tools and their configs, or templates into a custom pack. An optional LLM drafts the rules: bring-your-own key or local model, Meta Muse suggested by default, Llama and any other provider accepted (§12 #3, #19, #30). **The output is deterministic artifacts** — rule, enforcer, fixtures — that must pass the pack self-test and human acceptance before activation. The LLM never runs in any enforcement path (§6 P1). Without an LLM configured, the generator still works from templates and examples.

## 7.10 VS Code extension

A thin client over the same engine (§12 #2). It shows, live:

| View | Shows |
|---|---|
| **Active rules** | Packs, rules, tiers, bounds, waivers with expiry, per-layer coverage per harness |
| **Steering** | Exactly what was injected into the agent's context, and when |
| **Violations** | Current findings as editor diagnostics, with remediation |
| **Timeline** | Blocks, waivers, upgrades, integrity events, loop-breaker escalations |
| **Budget** | Context and token usage against bands, where the harness exposes it |
| **Health** | Ratchet trends, dependency freshness, guardrail integrity |

Installing the extension is enough to start: in a repo without Codictator it offers one-click setup, which hands `init` to the human in a terminal. The extension can run Codictator commands; it cannot do anything the CLI refuses.

## 7.11 Transparency and records

| Record | Where | Purpose |
|---|---|---|
| Event log | Local, git-ignored | Every verdict, injection and escalation, for the extension and metrics |
| Waivers, baselines, guardrail manifest | Committed | Reviewable state that CI verifies |
| Code history, doc changelogs, dependency change records | Committed | The *why* behind every change (§8 F8) |
| CI summary | CI job output | Per-run verdicts, waivers in force, ratchet movement |

`explain` for any rule or verdict returns the rule, reason, enforcers, tier, bounds and remediation.

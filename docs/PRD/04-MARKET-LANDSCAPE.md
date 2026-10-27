# 4. Market Landscape

**[◀ 3. Scope Fence](03-SCOPE-FENCE.md)** · [PRD index](../PRD.md) · **[5. Personas ▶](05-PERSONAS.md)**

Verified by web search on 2026-10-26. Each row states what the tool does well, what it leaves open, and how Codictator relates.

## 4.1 Adjacent tools

| Tool / standard | Does | Leaves open | Codictator's relation |
|---|---|---|---|
| **AGENTS.md** (open standard, stewarded by the Agentic AI Foundation under the Linux Foundation) | One instruction file read by Codex, Copilot, Cursor, Gemini CLI, Jules, VS Code and others | Purely advisory; nothing checks the agent obeyed | Generates and owns the target's `AGENTS.md` as the steering layer; enforcement sits behind it |
| **Muse Code** (Meta's terminal coding agent, beta since 2026-08-05) | Reads `AGENTS.md` (falls back to `CLAUDE.md`) by directory scope; 17 lifecycle hook events including `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `Stop`; project hooks in `.muse/hooks.json`; skills in `.agents/skills`; headless `muse exec` | Primitives only; hook payload and reply formats undocumented; project hooks run only after the user trusts the folder; documented hooks expose no command to force a clear or compaction | Primary adapter target (§12 #30): every layer it exposes is used, gaps declared (§7.3) |
| **Ruler**, **rulesync** (npm), and similar sync CLIs | One rule source rendered into many harnesses; rulesync also renders commands, subagents, skills, MCP, hooks and permissions, with a CI staleness check | Ships no rules of its own and no checks on code; the content and enforcement are the user's problem | Same rendering idea, but rules arrive with enforcers. Codictator may reuse a sync library inside an adapter if it earns its place (SPEC decides) |
| **Other harness hook systems** (Claude Code, Codex CLI, Copilot, Cursor, Gemini CLI, OpenCode) | Pre/post tool events that can block; Claude Code's JSON-on-stdin, exit-2-to-block shape is shared by Codex CLI and is the de facto convention | Primitives only; every repo hand-writes its own scripts; some (Codex CLI) require the user to trust each hook once | The substrate Codictator's adapters render into |
| **TDD Guard** and similar single-concern hooks | Blocks implementation edits without a failing test, in Claude Code | One concern, one harness; some variants call an LLM to judge | TDD is one rule family among many (§8 F4), enforced deterministically across harnesses |
| **GitGuardian ggshield AI hooks**, Endor Labs, Pillar and enterprise agent-governance suites | Secret and policy scanning on prompts, commands, reads and MCP calls across agents | Security only; commercial or enterprise-oriented | Codictator covers secrets as a floor family and can call such a scanner as an enforcer |
| **Kiro** (AWS agentic IDE) | Spec-driven requirements → design → tasks, steering files, event hooks | Tied to one IDE and its credit model; hooks are user-authored, often natural-language | Harness-neutral; ships the rules rather than a place to write them |
| **GitHub Spec Kit** | Constitution → specify → plan → tasks → implement commands for many agents | No verification loop; nothing checks the result against the spec | Codictator enforces the loop's gates (tests first, review, record) that Spec Kit only describes |
| **Renovate**, **Dependabot** | Mature update PRs, grouping, schedules, advisories | Proposes; never blocks a merge on staleness; easy to ignore or close | Codictator owns the blocking *verdict*, generates their config and reuses them; it opens upgrade PRs itself only when neither is present (§12 #28) |
| **dependency-cruiser**, ArchUnit-style tests, Nx module boundaries | Architecture rules as checks | Every rule hand-authored per repo | Ships architecture profiles pre-authored and wires them as gates |
| **CodeRabbit** and other AI PR reviewers | LLM review comments on PRs | Advisory and non-deterministic; cannot be a hard gate | Complementary; Codictator's gate is deterministic, review is a workflow step it requires |
| **Trunk** and meta-linters | Orchestrate many linters, hold-the-line on new issues | Code-quality only; no agent steering, docs, history or token rules | Same ratchet idea; Codictator extends it to agent behaviour |

## 4.2 Honest differentiation

| Codictator is better at | Others are better at |
|---|---|
| Enforcing every family together under one rule model and one audit trail | Breadth of harness targets (sync tools render into more tools today) |
| A non-negotiable floor no prompt or waiver moves | Dependency-update ergonomics (Renovate's maturity) |
| Steering agents toward the compliant alternative, not only blocking | Rich LLM review commentary (AI reviewers) |
| Token and context hygiene as an enforced concern | Integrated IDE experience (Kiro) |
| Docs and change-history enforcement | Enterprise security governance and central policy (security suites) |

**Position:** Codictator is the opinionated layer that composes existing primitives and checkers into an enforced whole. Where a mature tool exists, Codictator configures and gates it rather than rewriting it (§6 P7).

## 4.3 Sources

[Muse Code launch](https://techcrunch.com/2026/08/05/meta-launches-muse-code-an-ai-agent-for-large-code-bases/) · [Muse Code hooks](https://dev.meta.ai/docs/muse-code/extending) · [Codex CLI hooks](https://codex.danielvaughan.com/2026/04/15/codex-cli-hooks-complete-guide-events-policy-patterns/) · [AGENTS.md](https://agents.md/) · [Linux Foundation AAIF announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) · [Ruler](https://github.com/intellectronica/ruler) · [rulesync](https://github.com/dyoshikawa/rulesync) · [TDD Guard fork](https://github.com/hesreallyhim-forks/tdd-guard-fork) · [ggshield AI hooks](https://blog.gitguardian.com/ai-hooks-ai-coding-assistants/) · [Endor Labs agent governance](https://www.endorlabs.com/learn/introducing-agent-governance-using-hooks-to-bring-visibility-to-ai-coding-agents) · [Guardrails: rules, hooks, CI](https://axonbuild.com/blog/guardrails-for-ai-coding-agents/) · [Spec Kit vs Kiro](https://codemyspec.com/blog/spec-kit-vs-kiro)

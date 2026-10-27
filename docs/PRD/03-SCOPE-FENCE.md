# 3. Scope Fence — What Codictator Is and Is Not

**[◀ 2. Problem](02-PROBLEM.md)** · [PRD index](../PRD.md) · **[4. Market Landscape ▶](04-MARKET-LANDSCAPE.md)**

## Codictator IS

- **A guardrail generator and guard.** It writes enforcement into the target repo (context files, harness hooks, git hooks, CI workflows, checks) and runs those checks continuously (§12 #1).
- **Deterministic at its core.** The same repo state, rule set and registry snapshot always give the same verdict; no LLM decides a pass or a block (§6 P1).
- **Harness- and model-neutral.** One rule set rendered natively per harness, with git hooks and CI covering any harness without an adapter; the guards judge the change, so they work whatever model the harness runs.
- **Opinionated with a floor.** It ships defaults it believes are correct and refuses to go below the floor, whatever the prompt says (§6 P2).
- **A steering system.** It changes what the agent does — by injecting the right instruction and the compliant alternative — rather than only refusing.
- **Transparent.** Every rule, injection, block, waiver and upgrade is visible in the CLI, the extension and committed records.
- **Polyglot by packs.** Language-agnostic rules apply to any repo; language packs add language-specific enforcement (§12 #4).
- **Self-governed.** Codictator's own repo runs under Codictator (§12 #5).

## Codictator IS NOT

| Not | Why the line is drawn |
|---|---|
| **A coding agent or harness** | It governs agents and never writes feature code; its own edits are generated guardrail files and mechanical dependency upgrades. Competing with harnesses would make it one more harness to govern. |
| **An LLM-based code reviewer** | Non-deterministic verdicts cannot be a gate. The workflow *requires* a fresh-session agent review (§8 F11), but the gate is that the review happened and its findings were resolved. |
| **A prompt filter** | Refusing prompts is bypassable by rephrasing; enforcing on the produced change is not. |
| **A replacement for compilers, linters, test runners or scanners** | It configures, pins and gates them; reinventing them would be worse and larger. |
| **A cloud service** | Runs locally and in the repo's own CI; no account, no Codictator server, network only as §6 P8 allows. |
| **A secret store or runtime security product** | It blocks secrets from entering the repo and the agent's context; it does not manage them. |
| **Unbreakable against an administrator** | Anyone with write access can delete files. Codictator makes removal loud and CI-failing, never silent (§11.1). |
| **A license or compliance certifier** | It enforces dependency license policies the user sets; it gives no legal opinion. |

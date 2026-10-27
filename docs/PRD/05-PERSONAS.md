# 5. Personas

**[◀ 4. Market Landscape](04-MARKET-LANDSCAPE.md)** · [PRD index](../PRD.md) · **[6. Product Principles ▶](06-PRODUCT-PRINCIPLES.md)**

## 5.1 Users

| Persona | Situation | Needs from Codictator | Success looks like |
|---|---|---|---|
| **Solo agent-first developer** (primary) | Builds alone with one or more harnesses; no reviewer but the agent | A harness-maxxed repo in one command; trust that the agent cannot cut corners while unattended | Leaves an agent running; returns to green, reviewed, recorded commits |
| **Team lead / platform engineer** | Contributors use different harnesses and habits | One enforced standard regardless of harness; visible waivers; CI parity | No harness-specific drift; review time drops |
| **Open-source maintainer** | Receives agent-written PRs from strangers | CI that rejects floor violations before a human reads the PR | Low-quality PRs bounce automatically with the reason attached |
| **Brownfield adopter** | Large existing codebase far below the floor | Adoption without a permanently red build | Debt counts fall every week; nothing new gets worse |
| **Guardrail author** | Has in-house standards, examples or templates | Turn them into enforced rules without writing hook plumbing | Custom rule pack passes its fixtures and runs everywhere |

## 5.2 Actors Codictator acts on

| Actor | How Codictator treats it |
|---|---|
| **The AI agent** | Primary subject. Receives injected context, compliant alternatives on block, budget signals. Never trusted to self-certify. |
| **A reviewer subagent** | Must be a fresh session with no author context; its verdict is recorded, not trusted blindly. |
| **CI runner** | The authoritative enforcer; re-runs every check independent of local state. |

## 5.3 Anti-persona — designed against, not for

| Anti-persona | Behaviour | Product response |
|---|---|---|
| **The corner-cutter** | Prompts for skipped tests, disabled checks, pinned old versions, "just make it pass" | Floor holds; agent is steered to the compliant path; the attempt is logged and visible |
| **The tamperer** | Deletes hooks, edits config, uses `--no-verify`, removes the CI job | Integrity check fails locally and in CI; removal is reported, never silent (§11.1) |
| **The token burner** | Drives sessions far past budget, rereads everything, demands verbose output | Budget bands, forced checkpoint and clear, read de-duplication, terse-output mode (§8 F1) |

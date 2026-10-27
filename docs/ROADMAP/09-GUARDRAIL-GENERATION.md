# 9. Guardrail Generation

**[◀ 8. Dependencies and Remediation](08-DEPS-REMEDIATION.md)** · [Roadmap index](../ROADMAP.md) · **[10. Self-Host ▶](10-SELF-HOST.md)**

| | |
|---|---|
| **Depends on** | Phase 8 |
| **Delivers** | Everything `init` and `regen` generate and everything that guards it: context and injection, budget bands, agent assets, the manifest, self-protection, git hooks, the CI workflow; the remaining P0 adapters; every CLI command of SPEC §4.19.2 except `serve` |
| **Read** | SPEC §4.5, §4.6, §4.14, §4.15, §4.18, §4.19, §5.1, §5.11, §5.12, §7.1, §7.14, §8 |
| **Covers** | `§4.6`, `§4.14`, `§4.15`, `§4.5 EC-3..8`, `§4.5 EC-10`, `§4.5 EC-12`, `§4.5 EC-20..24`, `§4.4 EC-14`, `§4.18 EC-4..7`, `§4.19 EC-1`, `§4.19 EC-2`, `§4.19 EC-7`, `§5.1`, `§5.11`, `§5.12`, `§8.1`, `§8.2` |

## Steps

- [ ] **9.1** steering: precedence statement, the `AGENTS.md` managed block within its budget, scoped injection, budget bands and checkpoints, read cache, graph-before-scan, MCP declaration (SPEC §4.6.1–§4.6.5). Verify: §4.6 EC-1–13.
- [ ] **9.2** Agent asset templates of SPEC §4.6.6 and `core/agent-assets-present`. Verify: §4.4 EC-14 and the §5.12 fixtures.
- [ ] **9.3** Muse Code and OpenCode render completed with the steering content, including OpenCode's per-prompt injection, probe fallback and version check. Verify: render goldens, byte-identical on regeneration (§4.5 EC-12); §4.5 EC-20–24.
- [ ] **9.4** Universal, Claude Code, GitHub Copilot and Codex CLI adapters, with goldens and capability declarations (SPEC §4.5.4). Verify: §4.5 EC-3–8, EC-10.
- [ ] **9.5** integrity: manifest, drift and tamper checks, self-protection paths and commands, git-hook installation, `regen` (SPEC §4.14). Verify: §4.14 EC-1–12.
- [ ] **9.6** ci: generated workflow, required-check and branch-protection reads, bot-change recording, sweep, external CI (SPEC §4.15). Verify: §4.15 EC-1–10.
- [ ] **9.7** audit surfaces: `explain`, `replay`, `status`, the CI summary, `report` (SPEC §4.18.2–§4.18.5). Verify: §4.18 EC-4–7.
- [ ] **9.8** Every remaining command of SPEC §4.19.2, `init` included, with `--json` schemas, terse output and the exit codes of §8.2. Verify: §4.19 EC-1, EC-2, EC-7; the §8.1 and §8.2 tests.
- [ ] **9.9** The stress rows of SPEC §10.5 for `pre-commit`, `ci verify` and `status` meet the §9.3 budgets. Verify: `npm run test:stress`.

## Exit gate

- `npm run ledger -- --covers` with every row of **Covers** exits 0.
- Always-set and `npm run test:stress` green on all three OSes.
- `codictator init` on each fixture repo produces a byte-identical guardrail set on all three OSes.

# 9. Release Scope

**[◀ 8. Rule Families](08-RULE-FAMILIES.md)** · [PRD index](../PRD.md) · **[10. Success Metrics ▶](10-SUCCESS-METRICS.md)**

## 9.1 First release

Everything below ships in the first release. The priority column is the build order and, if scope must yield, the cut order: P0 is never cut.

| Area | Scope | Priority |
|---|---|---|
| Engine (§7.1) | All layers L0–L5, fail-closed, loop breaker, `explain` | P0 |
| Core pack (§7.2) | Every family in §8 that needs no language knowledge | P0 |
| Core pack (§7.2) | F6 duplication caps and no-invented-abstraction checks | P1 |
| TypeScript / JavaScript pack | Full, including npm dependency enforcement | P0 |
| Muse Code adapter (§7.3) | Every layer the harness exposes; built and tested first; primary demo target (§12 #30) | P0 |
| Adapters (§7.3) | OpenCode (with Meta Model API provider setup), Universal, Claude Code, GitHub Copilot, Codex CLI | P0 |
| Adapters (§7.3) | Cursor, Gemini CLI | P1 |
| Integrity (§7.7) and CI generation (F13) | Full; GitHub Actions generated, other CI hosts run one documented command (§12 #36) | P0 |
| Adoption (§7.8) | Install, brownfield baseline, ratchet | P0 |
| Workflow engine (§7.6) | Default workflow, customisation within §6.1, single- and multi-agent | P0 |
| Dependency enforcement (§7.5) | npm and Renovate/Dependabot config generation (P0); NuGet and PyPI with their packs (P1) | P0 / P1 |
| .NET pack, Python pack | Full, in that order | P1 |
| VS Code extension (§7.10) | Active rules, violations, timeline (P0); steering, budget, health (P1) | P0 / P1 |
| Custom guardrail generator (§7.9) | Template and example path; LLM-assisted path with Muse as the default provider preset | P1 |
| Distribution | npm package `codictator`; extension under publisher `codictator` on the VS Code Marketplace and Open VSX (the registry Cursor and other forks use) | P0 |
| Dogfooding (§6 P11) | Codictator's repo runs under Codictator | P0 |

## 9.2 Later

| Item | Why later |
|---|---|
| More harness adapters (Windsurf, Cline, Aider, Kiro, JetBrains AI, …) | Universal adapter covers them meanwhile; native adapters follow demand |
| More language packs (Go, Java/Kotlin, Rust, …) | Pack model is ready; each pack needs its own enforcers and fixtures |
| Organisation-wide policy (one rule set across many repos) | Needs a distribution story beyond a single repo without breaking §6 P8 |
| Community pack registry | Needs a trust and signing model for third-party enforcers |
| Generated CI for GitLab and other hosts | Needs each host's API for required checks and PRs; the one-command path covers them meanwhile (§12 #36) |
| Editors other than VS Code-family | The CLI already works everywhere; UI follows demand |

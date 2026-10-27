# 10. Success Metrics

**[◀ 9. Release Scope](09-RELEASE-SCOPE.md)** · [PRD index](../PRD.md) · **[11. Risks & Mitigations ▶](11-RISKS-MITIGATIONS.md)**

Every metric names its measurement source. All sources are local or in the target repo's CI — nothing is collected centrally (§6 P8). Targets are SPEC-owned; the direction is fixed here.

| Category | Metric | Direction | Why it matters | Measurement source |
|---|---|---|---|---|
| **North Star** | **Floor escape rate** — floor-rule violations present on the default branch | Zero, always | The product's entire promise | L4 verify on every default-branch commit; CI summary |
| Steering | **Self-correction rate** — blocks the agent resolved compliantly without human help | Up | Measures steer-not-refuse (§6 P4) | Local event log: block followed by passing re-check in the same task |
| Steering | **Loop-breaker escalations** per task | Down | Each is a rule the agent could not satisfy alone — a remediation to improve | Local event log |
| Precision | **False-positive rate** — blocks later judged wrong and fixed in the rule | Down | False positives are what make users disable guards | Rule-fix records referencing the blocking event |
| Tokens | **Tokens per completed task** and **budget-band breaches** per session | Down | Measures F1 | Harness usage data where the adapter exposes it; otherwise marked unavailable, never estimated |
| Dependencies | Known-vulnerable dependencies; share at latest stable; median lag | Zero; up; down | Measures F3 | Dependency check report (L4, L5) |
| Health | **Ratchet totals** per metric | Monotonic down | Measures continuous improvement (§6 P9) | Committed baseline and its history |
| Integrity | Tamper and drift events; time from event to restored guardrail | Zero after adoption; down | Measures resistance to disabling | Integrity check results (L3, L4) |
| Meta-first | Muse Code and OpenCode adapter layer coverage — layers enforced natively over layers the harness exposes | 100% | Muse Code is the primary target and OpenCode the dogfooding harness (§12 #21, #30) | Adapter capability declarations checked by adapter fixtures in CI |
| Rule quality | Rules with an enforcer and a violating fixture that is caught | 100% | §6 P3 | Pack self-test in CI |
| Overhead | p95 latency of L1 and L3 checks | Within budget | Slow guards get bypassed | Local event log timings |
| Adoption | Time from install to first green verify on a fresh repo | Down | Friction decides whether anyone keeps it | Install command timing in the event log |
| Reach | npm weekly downloads; extension installs on both marketplaces | Up | Public demand signal | npm registry stats; marketplace stats |
| Credibility | Codictator's own repo passes its own verify | Always | §6 P11 | Codictator's CI |

## 10.1 The two that decide whether it works

1. **Floor escape rate.** Any non-zero value is a product defect, fixed before any new feature.
2. **Self-correction rate.** If agents mostly hit walls instead of converging, the remediations are wrong and users will turn the product off.

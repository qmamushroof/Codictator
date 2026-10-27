# 11. Risks & Mitigations

**[◀ 10. Success Metrics](10-SUCCESS-METRICS.md)** · [PRD index](../PRD.md) · **[12. Decisions Log ▶](12-DECISIONS-LOG.md)**

## 11.1 Users will try to disable it — the top risk

**Risk:** the stricter the guard, the stronger the urge to delete it, skip it with `--no-verify`, edit its config, or tell the agent to.

**Mitigation:** layered defence where each layer covers the previous one's bypass. Agent hooks block the agent from editing guardrails or running bypass commands (§7.7); git hooks catch what the agent layer missed. CI re-verifies everything, including the guardrail manifest, so a deleted or edited guardrail fails the merge gate (§6 P6). Install generates the CI job and asks for it to be a required check on the default branch; CI verify fails when the git host reports it is not required.

**Accepted and stated:** an administrator can delete Codictator, its CI job and the branch protection. Codictator cannot prevent that and does not pretend to; it makes it visible in history and in every verify that still runs. The real defence is §11.3 — a guard people do not want to remove.

## 11.2 "Only reasonable requests" versus user autonomy

**Risk:** refusing requests feels hostile; complying with every request empties the product.

**Mitigation:** the line is fixed once in §6.1 — *how* is negotiable, *whether* is not. Tunables give real room, bounded and visible; the floor is small, explained and identical for everyone. Every refusal carries the compliant alternative, so the user always has a path forward.

## 11.3 False positives

**Risk:** a wrong block costs trust faster than ten right ones earn it, and a team that hits several turns the product off.

**Mitigation:** deterministic rules with violating *and* passing fixtures (§6 P3); loop breaker escalates instead of trapping (§7.1); `explain` shows exactly why; the false-positive rate is a tracked metric (§10). A false positive in a floor rule is fixed in the rule, never waived.

## 11.4 Harness API churn

**Risk:** hook events, config paths and context-file conventions change often and differ per harness; Muse Code, the primary target, is a proprietary beta and likely to churn most.

**Mitigation:** adapters are isolated modules behind one contract, each declaring the harness versions it was verified against. Capability honesty (§7.3) means a broken adapter degrades to Universal plus CI rather than to nothing. Adapter fixtures run in CI against the declared formats, and the Muse Code adapter is re-verified against each Muse Code release before the others.

## 11.5 Overhead and latency

**Risk:** slow hooks make every agent step slower and invite bypass.

**Mitigation:** fast subsets at L1 and L3, full checks at L4; incremental evaluation on changed files; latency budget as a metric (§10).

## 11.6 Agent loops and token burn caused by the guard

**Risk:** an agent repeatedly blocked can burn more tokens than the violation would have cost.

**Mitigation:** remediation on every block (§6 P4) and the loop breaker (§7.1); scoped, size-budgeted injection (§6 P10).

## 11.7 Forced upgrades break builds

**Risk:** "latest stable, no mercy" can pull a breaking major.

**Mitigation:** upgrades land as ordinary changes through the full workflow and test suite; a failing upgrade becomes a recorded upgrade task, with the old version allowed only within the tunable lag allowance. A vulnerable version has no allowance (§12 #15). Minimum release age guards against freshly published compromised packages (§12 #14).

## 11.8 Codictator's own supply chain

**Risk:** a guard installed into many repos is a high-value target.

**Mitigation:** minimal dependencies (§12 #5), exact pins, signed and provenance-attested releases, its own floor applied to itself (§6 P11), no network beyond §6 P8.

## 11.9 Breadth of scope

**Risk:** many families, packs and adapters can produce a shallow product.

**Mitigation:** one engine and one rule model so families are data plus enforcers, not separate products; P0/P1 cut order (§9.1); reuse existing checkers instead of building them (§6 P7).

## 11.10 LLM-generated guardrails are wrong

**Risk:** the generator drafts a rule that blocks good code or misses bad code.

**Mitigation:** generated rules are inert until they pass their own fixtures and a human accepts them (§7.9); the LLM never runs at enforcement time (§6 P1).

## 11.11 Brownfield shock

**Risk:** installing into a large legacy repo produces thousands of findings.

**Mitigation:** baseline and ratchet (§7.8): nothing new may get worse, debt falls over time, and only floor items needing no human decision are fixed immediately.

## 11.12 The name

**Risk:** "Dictator" can read as hostile or offensive in some markets.

**Mitigation:** accepted as the product's stance; tone in all messages is plain and helpful rather than punitive.

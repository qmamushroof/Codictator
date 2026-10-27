# 6. Product Principles

**[◀ 5. Personas](05-PERSONAS.md)** · [PRD index](../PRD.md) · **[7. Feature Areas ▶](07-FEATURE-AREAS.md)**

Non-negotiable. Each names how it is enforced — a principle with no enforcer is a preference, and preferences drift across agent sessions. The SPEC gives each enforcer its concrete check.

| # | Principle | Reason | Enforced by |
|---|---|---|---|
| **P1** | **Deterministic verdicts.** No LLM decides any pass, block or waiver. Same repo state, rules and registry snapshot → same verdict. | A gate that can be talked out of its answer is not a gate. | Architecture test: enforcement modules cannot import the LLM module; replay test asserts identical verdicts. |
| **P2** | **A floor no prompt moves.** Floor rules have no waiver and no off switch. Tunable rules may be tightened freely, loosened only within their pack-owned bounds, with a reason and an expiry; users cannot widen a bound (§12 #29). | The product's whole promise collapses at the first "just this once". | Config validation rejects floor overrides and out-of-bound values; CI re-validates. |
| **P3** | **A rule needs an enforcer.** Every rule ships with at least one enforcer and a fixture that violates it, and a test proving the enforcer catches it. | An enforcer that cannot detect its rule is worse than none — it is trusted. | Pack loader refuses a rule lacking either; pack self-test in CI. |
| **P4** | **Steer, never only refuse.** Every block states the rule, the reason, and the compliant alternative the agent should take instead. | An agent told only "no" retries variations and burns tokens; one told what to do converges. | Rule schema requires a remediation; test asserts every block message carries it. |
| **P5** | **Total transparency.** Every injection, block, waiver, upgrade and integrity event is recorded and viewable; nothing is enforced silently. | Users accept strictness they can see and audit; they rip out strictness they cannot. | Engine records the event before returning a verdict; test asserts no verdict without a record. |
| **P6** | **CI is the source of truth.** Local hooks are early feedback and can be bypassed; CI re-runs everything, including guardrail integrity. | Any local layer can be skipped by a determined user; the merge gate cannot without visible admin action. | Install does not complete without a CI workflow; integrity check runs in CI. |
| **P7** | **Reuse before build.** Platform first, then an existing tool, then new code — for Codictator and for every target. | Smaller code is cheaper to read, test, secure and send as tokens. | Solution-size family (§8 F6) runs on Codictator's own repo. |
| **P8** | **Local and private.** No account, no server, no telemetry. Network use is limited to package registries, advisory databases, the repo's own git host (checks and upgrade PRs) and an LLM endpoint the user configures. | A guard that phones home is a guard nobody installs. | Engine network allowlist; test fails on any other outbound call. |
| **P9** | **Ratchet, never regress.** Existing debt is baselined and may only fall; anything a change touches must not get worse. | A permanently red build gets switched off; a ratchet keeps improving. | Baseline check in every layer; a raised baseline fails CI. |
| **P10** | **Minimal tokens, including our own.** Everything Codictator injects or prints has a size budget and the tersest form that stays decidable. | A token-hygiene tool that floods context is self-defeating. | Size-budget tests on generated context and messages. |
| **P11** | **Practise what is preached.** Codictator's own repo runs under Codictator with the same floor. | A rule its author will not follow is not credible. | Codictator's CI runs its own full verify. |
| **P12** | **Every platform.** Windows, macOS and Linux behave identically. | Hooks that only run in one shell leave the other platforms unguarded. | CI matrix across the three OS families. |

## 6.1 "Only reasonable requests" — resolved once

The founder requires that Codictator obey only reasonable requests and never dumb down. A request is **reasonable** when it changes *how* quality is achieved without lowering *whether* it is achieved.

| Request | Verdict |
|---|---|
| Tighten any threshold, add rules, add workflow phases, add reviewers | Accepted, recorded |
| Choose among supported profiles (architecture, test runner, harness set) | Accepted, recorded |
| Loosen a tunable threshold inside its bound, with reason and expiry | Accepted as a waiver, shown everywhere until it expires |
| Loosen a tunable beyond its bound, or without reason or expiry | Refused with the bound and the compliant alternative; a wider bound needs a new pack version with a recorded reason |
| Disable, skip or weaken any floor rule; remove a mandatory workflow gate | Refused; the attempt is logged |
| Ask the agent to violate a rule in a prompt | The agent is steered to the compliant path; the guard blocks the violating change regardless |

**Never dumbing down** means the floor and remediation text are identical for every user and every prompt; Codictator explains plainly but never lowers the bar to be agreeable.

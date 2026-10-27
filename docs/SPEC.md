# SPEC — Codictator

| § | Read this when | File |
|---|---|---|
| 1 | What the SPEC owns, conflict order, citation format, how to change it, P0/P1/Later scope tiers | [01-DOCUMENT-IDENTITY.md](SPEC/01-DOCUMENT-IDENTITY.md) |
| 2 | Toolchain, verified versions, every dependency and why it exists | [02-STACK.md](SPEC/02-STACK.md) |
| 3 | Repo layout, module list, allowed dependencies, public interfaces, extension points | [03-ARCHITECTURE.md](SPEC/03-ARCHITECTURE.md) |
| 4.1 | **kernel** — ports (fs, process, net, clock), hashing, paths, schema validator, secret redaction | [04-01-KERNEL.md](SPEC/04-01-KERNEL.md) |
| 4.2 | **config** — loading, validation, tightening, the human-only change path | [04-02-CONFIG.md](SPEC/04-02-CONFIG.md) |
| 4.3 | **engine** — rule model, tiers, bounds, waivers, ratchet, evaluation, verdicts, fail-closed | [04-03-ENGINE.md](SPEC/04-03-ENGINE.md) |
| 4.4 | **packs** — pack model, loader, self-test, external-tool enforcers, custom packs | [04-04-PACKS.md](SPEC/04-04-PACKS.md) |
| 4.5 | **adapters** — adapter contract, capability declaration, Muse Code first, OpenCode with Meta Model API, every harness | [04-05-ADAPTERS.md](SPEC/04-05-ADAPTERS.md) |
| 4.6 | **steering** — context files, scoped injection, budget bands, read de-duplication | [04-06-STEERING.md](SPEC/04-06-STEERING.md) |
| 4.7 | **security** — secret detection, shell analysis, write confinement | [04-07-SECURITY-GUARDS.md](SPEC/04-07-SECURITY-GUARDS.md) |
| 4.8 | **deps** — registries, advisories, latest stable, lag, bots, upgrade PRs | [04-08-DEPENDENCIES.md](SPEC/04-08-DEPENDENCIES.md) |
| 4.9 | **records** — doc architecture checks, change history, bug registry | [04-09-RECORDS.md](SPEC/04-09-RECORDS.md) |
| 4.10 | **testing** — SPEC trace, red proof, scenario classifier, test integrity | [04-10-TESTING.md](SPEC/04-10-TESTING.md) |
| 4.11 | **arch** — profiles, import graph, boundaries, cycles, fitness checks | [04-11-ARCHITECTURE-GUARDS.md](SPEC/04-11-ARCHITECTURE-GUARDS.md) |
| 4.12 | **workflow** — phases, gates, task records, review gate, loop breaker, multi-agent | [04-12-WORKFLOW.md](SPEC/04-12-WORKFLOW.md) |
| 4.13 | **remediation** — brownfield baseline, step-by-step non-breaking removal plan | [04-13-REMEDIATION.md](SPEC/04-13-REMEDIATION.md) |
| 4.14 | **integrity** — guardrail manifest, drift and tamper detection, self-protection | [04-14-INTEGRITY.md](SPEC/04-14-INTEGRITY.md) |
| 4.15 | **ci** — generated CI workflow, required checks, scheduled sweeps | [04-15-CI.md](SPEC/04-15-CI.md) |
| 4.16 | **generator** — custom guardrail generation from requirements, examples, templates | [04-16-GENERATOR.md](SPEC/04-16-GENERATOR.md) |
| 4.17 | **llm** — provider-agnostic client, Meta Muse default preset | [04-17-LLM.md](SPEC/04-17-LLM.md) |
| 4.18 | **audit** — event log, `explain`, CI summary | [04-18-AUDIT.md](SPEC/04-18-AUDIT.md) |
| 4.19 | **cli** — commands, hook entry point, launcher, Node prerequisite, stdio server | [04-19-CLI.md](SPEC/04-19-CLI.md) |
| 4.20 | **extension** — VS Code extension, views, protocol client | [04-20-EXTENSION.md](SPEC/04-20-EXTENSION.md) |
| 5 | Core pack rule catalogue — ids, tiers, defaults, bounds, enforcers, layers | [05-CORE-RULES.md](SPEC/05-CORE-RULES.md) |
| 6 | Language packs — TypeScript/JavaScript, .NET, Python | [06-LANGUAGE-PACKS.md](SPEC/06-LANGUAGE-PACKS.md) |
| 7 | Every file and wire format — config, pack, hook I/O, records, event log, protocol | [07-FILES-AND-FORMATS.md](SPEC/07-FILES-AND-FORMATS.md) |
| 8 | Error codes and exit codes | [08-ERRORS-EXIT-CODES.md](SPEC/08-ERRORS-EXIT-CODES.md) |
| 9 | Codictator's own security, privacy and performance budgets | [09-SECURITY-PERFORMANCE.md](SPEC/09-SECURITY-PERFORMANCE.md) |
| 10 | Testing strategy for Codictator itself, the red ledger | [10-TESTING-STRATEGY.md](SPEC/10-TESTING-STRATEGY.md) |
| 11 | SPEC decisions (`S#`) | [11-DECISIONS.md](SPEC/11-DECISIONS.md) |

# 7. Process Guards

**[◀ 6. Hook Path](06-HOOK-PATH.md)** · [Roadmap index](../ROADMAP.md) · **[8. Dependencies and Remediation ▶](08-DEPS-REMEDIATION.md)**

| | |
|---|---|
| **Depends on** | Phase 6 |
| **Delivers** | Documentation, history and bug-registry checks; SPEC trace, red proofs and test integrity; the import graph and architecture profiles; tasks, gates, review and the loop breaker; the TypeScript pack supplies they need |
| **Read** | SPEC §4.9–§4.12, §5.4–§5.10, §6.1, §6.4, §7.7, §7.11, §7.16, §8 (E6xx) |
| **Covers** | `§4.9`, `§4.10`, `§4.11`, `§4.12`, `§5.4`–`§5.10`, `§6.1`, `§6.4 EC-2..5`, `§6.4 EC-9`, `§10.3` |

Split by module in the order arch → records → testing → workflow, since testing needs the import graph and workflow needs testing (SPEC §3.3). `core/duplication` and `core/no-speculative-abstraction` are P1 and stay listed until [phase 12](12-P1-SCOPE.md).

## Steps

- [ ] **7.1** `typescript` pack supplies: import extractor and resolution, function-size, cyclomatic and dead-code measures, test-title extraction and filters, assertion, skip and suppression patterns, file naming, strict settings (SPEC §6.1). Verify: §6.4 EC-2–5, EC-9.
- [ ] **7.2** arch: profiles and layers, module map, graph cache, every check of SPEC §4.11.4. Verify: §4.11 EC-1–13.
- [ ] **7.3** The arch guard runs on Codictator's own `src/` with the SPEC §3.3 map. Verify: §10.3 item 1 leaves the ledger with zero findings.
- [ ] **7.4** records: doc classes and every check of SPEC §4.9.2; history entry rules and append-only check; bug registry rules. Verify: §4.9 EC-1–15.
- [ ] **7.5** testing: SPEC trace, red and green proofs from JUnit reports with the worktree re-run, scenario classifier, test-integrity rules and exceptions (SPEC §4.10). Verify: §4.10 EC-1–15.
- [ ] **7.6** workflow: task records and lock, phases and change classes, custom phases, L1 write gating, review gate, loop breaker, multi-agent roles (SPEC §4.12). Verify: §4.12 EC-1–14.
- [ ] **7.7** Code-health enforcers for `core/file-size`, `core/function-size`, `core/complexity`, `core/dead-code`, `core/no-guard-removal`, `core/ratchet-touched-improves`, `core/max-file-bytes`, and the `ts/typecheck`, `ts/lint`, `ts/no-phantom-import` pack rules. Verify: their fixture cases.

## Exit gate

- `npm run ledger -- --covers` with every row of **Covers** lists only the fixture tests of `core/duplication` and `core/no-speculative-abstraction` (phase 12) and of `core/remediation-step-size` (phase 8).
- VALIDATION always-set green in CI on all three OSes.
- Codictator's own `src/` passes its arch guard (§10.3 item 1) and its doc checks run clean over `docs/`.

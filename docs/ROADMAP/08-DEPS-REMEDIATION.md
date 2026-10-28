# 8. Dependencies and Remediation

**[◀ 7. Process Guards](07-PROCESS-GUARDS.md)** · [Roadmap index](../ROADMAP.md) · **[9. Guardrail Generation ▶](09-GUARDRAIL-GENERATION.md)**

| | |
|---|---|
| **Depends on** | Phase 7 |
| **Delivers** | Registry-backed dependency verdicts for npm, bot configuration, Codictator's own upgrade changes; the brownfield baseline and the step-by-step remediation plan with its gates |
| **Read** | SPEC §4.8, §4.13, §5.3, §6.1 (driver `npm`, capability table), §7.12, §7.13, §11 S9, S12, S26; PRD §12 #14, #15, #28, #31 |
| **Covers** | `§4.8`, `§4.13`, `§5.3`, `§6.4 EC-1`, and the `core/remediation-step-size` fixtures of `§5.6` |

## Steps

- [x] **8.1** npm driver: manifests, exact-pin forms, lockfile sync, toolchain files, owned `.npmrc` entry (SPEC §6.1). Verify: the npm cases of the §5.3 fixtures, whose titles cite §5.3.
- [x] **8.2** Registry and OSV clients over the `Net` port, the registry snapshot and its freshness rules (SPEC §4.8.2, §4.8.4). Verify: §4.8 EC-4, EC-5, EC-8, EC-11 against the local replay server.
- [x] **8.3** "Latest stable" selection with the security exemption (SPEC §4.8.3). Verify: §4.8 EC-1–3, EC-9, EC-12, EC-14.
- [x] **8.4** Every verdict of SPEC §4.8.5, including capability catalogues and license policy. Verify: §4.8 EC-6, EC-7, EC-10, EC-13; §6.4 EC-1.
- [x] **8.5** Renovate and Dependabot detection and owned keys (SPEC §4.8.6). Verify: §4.8 EC-15.
- [x] **8.6** `deps upgrade --pr` branches and history entries (SPEC §4.8.7). Verify: acceptance test against a fake git host.
- [x] **8.7** Adoption sequence logic: detection, baseline capture, immediate floor remediation (SPEC §4.13.1). Verify: `ts-brownfield` acceptance tests.
- [x] **8.8** Remediation plan generation and ordering, step gates, mechanical step branches, rollback and split, `core/remediation-step-size`, dependency-major chains, strangler moves, pre-existing findings at L4 (SPEC §4.13.2–§4.13.8). Verify: §4.13 EC-1–15.

## Exit gate

- `npm run ledger -- --covers "§4.8" "§4.13" "§5.3" "§6.4 EC-1"` exits 0, and `--covers "§5.6"` lists only the two P1 rules.
- VALIDATION always-set green in CI on all three OSes; no test reached the public network.

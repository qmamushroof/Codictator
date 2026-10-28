# 5. Packs and Security

**[◀ 4. Engine Core](04-ENGINE-CORE.md)** · [Roadmap index](../ROADMAP.md) · **[6. Hook Path ▶](06-HOOK-PATH.md)**

| | |
|---|---|
| **Depends on** | Phase 4 |
| **Delivers** | Pack loading, composition and self-test; parametric and external-tool enforcers; the security guards every hook depends on |
| **Read** | SPEC §4.4, §4.7, §5.2, §6.1 (`ts/security-patterns`), §7.3, §7.4, §8 (E2xx, E3xx) |
| **Covers** | `§4.4 EC-1..13`, `§4.7`, `§5.2` (§4.4 EC-14 needs `core/agent-assets-present`: phase 9) |

## Steps

- [x] **5.1** Pack loader and composition: ordering, unique ids, custom-pack prefixes, enforcer resolution (SPEC §4.4.3). Verify: §4.4 EC-5, EC-13.
- [x] **5.2** Self-test with every assertion of SPEC §4.4.4; custom-pack acceptance and hash check (SPEC §4.4.7). Verify: §4.4 EC-1–4.
- [x] **5.3** `core` pack manifest with every SPEC §5 rule row as data; `typescript` pack manifest with the §6.1 pack rules. Rows whose enforcers land later keep their fixture tests listed. Verify: the loader accepts both packs.
- [x] **5.4** Parametric enforcers of SPEC §4.4.6 that need no later module: `pattern-forbid`, `pattern-require`, `path-placement`, `file-size`, `file-required`, `json-key`. Verify: their unit tests.
- [x] **5.5** External-tool contract: declaration, input modes, output parsers, batching, version probe, safety rules (SPEC §4.4.5). Verify: §4.4 EC-6–12 against stub executables.
- [x] **5.6** `core/no-secrets` on the kernel's detectors, scoped per trigger, and the secret-read guard (SPEC §4.7.1). Verify: §4.7 EC-1–4, EC-13, EC-14.
- [x] **5.7** Shell analyser and `command-forbid` (SPEC §4.7.2). Verify: §4.7 EC-5–7, EC-10–12; the 10,000-command row of §10.5.
- [x] **5.8** Write confinement (SPEC §4.7.3). Verify: §4.7 EC-8, EC-9.
- [x] **5.9** `ts/security-patterns` enforcer. Verify: its fixture cases.

## Exit gate

- `npm run ledger -- --covers "§4.4 EC-1..13" "§4.7" "§5.2"` exits 0, and the `ts/security-patterns` fixture tests are green.
- Always-set and `npm run test:stress` green on all three OSes.

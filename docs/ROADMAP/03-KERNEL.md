# 3. Kernel

**[◀ 2. Red Suite](02-RED-SUITE.md)** · [Roadmap index](../ROADMAP.md) · **[4. Engine Core ▶](04-ENGINE-CORE.md)**

| | |
|---|---|
| **Depends on** | Phase 2 |
| **Delivers** | The only module that touches the OS, network and clock, with every utility the other modules need |
| **Read** | SPEC §4.1, §3.3 hard boundaries, §4.7.1 detectors, §9.1, §9.2, §8 (E7xx), §11 S35 |
| **Covers** | `§4.1` |

## Steps

- [x] **3.1** `Result<T>`, `CdxError`, `parseJson`, `stableStringify`, `sha256`, `normalizeText`, `toRepoPath` (SPEC §4.1.2). Verify: their unit tests leave the ledger.
- [x] **3.2** Schema validator for the 2020-12 subset, rejecting unsupported keywords. Verify: §4.1 EC-9, EC-10.
- [x] **3.3** `globMatch` with the case rules of SPEC §4.1.2; `readTomlKeys`, `readYamlKeys`, `readTestReport` (JUnit and TRX). Verify: unit tests.
- [x] **3.4** Pattern safety check of SPEC §9.2 (length, nested quantifiers, backreferences, per-file budget). Verify: the ReDoS row of §10.5 leaves the ledger.
- [x] **3.5** `Fs` port: repo-root resolution, symlink-aware confinement, atomic writes, BOM handling. Verify: §4.1 EC-1–3, EC-7, EC-8, EC-12 and the integration tests on the real OS.
- [x] **3.6** `Proc` port: argv only, `shell: false`, env allowlist of §9.2, output cap, process-tree kill. Verify: §4.1 EC-5, EC-6 on all three OSes.
- [x] **3.7** `Net` port with the §9.2 host allowlist, redirect checks and the size cap; `Clock`, `Git` and `Env` ports. Verify: §4.1 EC-4, EC-11.
- [x] **3.8** `redactSecrets` with the detectors and value allowances of SPEC §4.7.1 (SPEC §4.1.2). Verify: §4.1 EC-13.

## Exit gate

- `npm run ledger -- --covers "§4.1"` exits 0.
- Always-set and `npm run test:stress` green on all three OSes.
- §10.3 items 3 and 6 still green.

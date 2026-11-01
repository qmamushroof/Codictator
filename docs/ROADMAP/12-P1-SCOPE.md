# 12. P1 Scope

**[◀ 11. Extension](11-EXTENSION.md)** · [Roadmap index](../ROADMAP.md) · **[13. Release ▶](13-RELEASE.md)**

| | |
|---|---|
| **Depends on** | Phase 10; step 12.9 also needs phase 11 |
| **Delivers** | Every P1 item of SPEC §1.6. Each step is independent and is the unit that gets cut when scope must yield |
| **Read** | SPEC §1.6, §4.5.4 (P1 rows), §4.5.6, §4.16, §4.17, §6.2, §6.3, §11 S23, S24; PRD §9.1, §12 #19, #30 |
| **Covers** | `§4.16`, `§4.17`, `§6.2`, `§6.3`, `§6.4 EC-6..8`, `§6.4 EC-10`, the remaining `§4.20` and `§5.6` tests, the Cursor, Gemini CLI and custom-adapter tests |

## Steps

- [x] **12.1** llm: presets with Meta `muse-spark-1.3` as the default suggestion, both wire formats, retries, key handling (SPEC §4.17). Verify: §4.17 EC-1–7 against the local replay server.
- [x] **12.2** generator: templates, LLM draft with one repair round, materialisation, self-test report, `--floor` (SPEC §4.16). Verify: §4.16 EC-1–10.
- [x] **12.3** `dotnet` pack with the NuGet driver (SPEC §6.2). Verify: §6.4 EC-6 and the §6.2 fixtures.
- [x] **12.4** `python` pack with the PyPI driver (SPEC §6.3). Verify: §6.4 EC-7, EC-8, EC-10 and the §6.3 fixtures.
- [x] **12.5** Cursor adapter (SPEC §4.5.4). Verify: its goldens and contract tests.
- [x] **12.6** Gemini CLI adapter (SPEC §4.5.4). Verify: its goldens and contract tests.
- [x] **12.7** Custom adapters and `adapter test` (SPEC §4.5.6). Verify: their contract tests.
- [x] **12.8** `core/duplication` and `core/no-speculative-abstraction` measures. Verify: their fixture cases with no false positive on Codictator's own `src/`.
- [x] **12.9** Extension views Steering, Budget and Health (SPEC §4.20.2). Verify: their extension tests.

## Exit gate

- `npm run ledger -- --covers` with every row of **Covers** exits 0 for every step not cut. A cut step's tests remain listed and are named in the PR that cuts it.
- VALIDATION always-set and `npm run test:extension` green in CI on all three OSes; `npx codictator verify --all` still clean.

# 15. Consumer Proof

**[◀ 14. Close-Out](14-CLOSE-OUT.md)** · [Roadmap index](../ROADMAP.md) · **[16. First Run ▶](16-FIRST-RUN.md)**

| | |
|---|---|
| **Depends on** | Phase 14 (may run in parallel with phases 16 and 17) |
| **Delivers** | Proof that the promise holds outside this repo: each PRD §8 family resists the PRD §5.3 anti-personas on target repos and live harnesses, and the PRD §10 metrics are measured |
| **Read** | PRD §5.3, §8, §10, §12 #18, #38; SPEC §4.5.2, §4.5.4, §4.5.7, §4.6.4, §4.18, §10 |
| **Covers** | The SPEC §10 scenario rows added by step 15.1 |

## Steps

- [ ] **15.1** SPEC first: add an anti-persona scenario table to SPEC §10.
  - **Task:** `docs`, branch `docs/15-antipersona-scenarios`.
  - **Do:** write one row per PRD §8 family. Each row names the fixture repo, the hostile instruction, the hook payload replayed at L1, the expected rule id, and the L3 and L4 verdicts for the same change forced by hand. Take instructions from the corner-cutter, tamperer and token burner behaviours of PRD §5.3.
  - **Verify:** fresh-session docs review; every row cites a rule id that `npx codictator explain <id>` resolves.
- [ ] **15.2** Write every scenario of step 15.1 as a failing acceptance test.
  - **Task:** `feature`, branch `feature/15-antipersona-red`.
  - **Do:** one test per row under `packages/codictator/tests/acceptance/`, titled with its SPEC reference, entered in the red ledger (SPEC §10.7), with its red proof recorded by `npx codictator test red --task <id>`. A test asserts the rule's own finding and its remediation text, never a fail-closed `CDX-E9xx` finding.
  - **Verify:** `npm test` is green with the new titles listed in the ledger.
- [ ] **15.3** Turn the scenarios green, one family per task.
  - **Task:** `feature` or `fix`, branch `feature/15-family-<id>` (for example `feature/15-family-f1`).
  - **Do:** fix the enforcer, steering text or layer mapping that lets the scenario through. A product defect gets its `docs/BUGS/` row first.
  - **Verify:** `npm run ledger -- --covers` with the step 15.1 rows exits 0.
- [ ] **15.4** Human: live runs on each P0 harness the founder can reach, OpenCode with a Meta model first.
  - **Do:** on a clone of the `ts-clean` fixture, run `npx codictator setup`. Give the agent three prompts: hard-code an API key, skip the failing test, pin a dependency to a vulnerable version. Record each harness's payloads with `npx codictator adapter capture <harness>` and commit the captures with updated `verifiedAgainst` values.
  - **Verify:** `npx codictator adapter test <id>` is green and `npx codictator status` shows L1 `active` and `.codictator/state/events.jsonl` holds three `block` decisions.
  - **Stop:** a harness lets a prompt through at L1. File the `docs/BUGS/` row; L3 and L4 must still block the change.
- [ ] **15.5** Human: first-party Muse Code capture (PRD §12 #38).
  - **Do:** with Muse Code access, run step 15.4 there and commit the capture, so `hookIoVerified` becomes true through SPEC §4.5.7.
  - **Verify:** `npx codictator status` shows Muse Code L1 `active`.
  - **Stop:** no access. Leave the gap declared, name it in the release notes, and tick the step with that note in the commit body.
- [ ] **15.6** Re-check each harness's context controls (PRD §8 F1).
  - **Task:** `docs` for the SPEC change, then `feature` per adapter, branch `feature/15-context-<harness>`.
  - **Do:** look up the vendor documentation for `autoCompactConfig`, `forceCompact`, `forceClear` and `usageData`. Where a control now exists, change SPEC §4.5.4 first, then the adapter and its goldens. Add one acceptance scenario per harness: the hard band blocks, a checkpoint is committed, and a fresh session resumes from the task record.
  - **Verify:** the adapter goldens and the new scenario are green; `status` shows each remaining gap verbatim.
- [ ] **15.7** Measure the PRD §10 metrics.
  - **Task:** `docs` if a target is missing, branch `docs/15-metric-targets`.
  - **Do:** run `npx codictator report` here and on the `ts-brownfield` fixture after step 15.3. Confirm SPEC owns a target for each PRD §10 row; add any missing target to SPEC. Attach both reports to the next GitHub Release.
  - **Verify:** every PRD §10 row has a value or the word "unavailable", and floor escape rate is zero.
- [ ] **15.8** Human and agent: false-positive sweep on real code.
  - **Do:** the founder picks three public repositories per shipped language pack and clones them outside this repo. Run `npx codictator setup` and `npx codictator verify --all` in each. Never name those repositories in a tracked file. For every block judged wrong, file a `docs/BUGS/` row with a minimal fixture, then fix it as its own task.
  - **Verify:** no false-positive row from the sweep is `open`.

## Exit gate

- `npm run ledger -- --covers` with the step 15.1 rows exits 0 on all three OSes.
- `npx codictator status` shows L1 `active` for every P0 harness captured in steps 15.4 and 15.5.
- The step 15.7 reports show a floor escape rate of zero.
- No bug row found by this phase is `open`.

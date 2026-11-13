# 14. Close-Out

**[◀ 13. Release](13-RELEASE.md)** · [Roadmap index](../ROADMAP.md) · **[15. Consumer Proof ▶](15-CONSUMER-PROOF.md)**

| | |
|---|---|
| **Depends on** | Phase 13 |
| **Delivers** | The phase 13 release made clean: an empty red ledger, no open bug row, a README that matches what ships |
| **Read** | SPEC §4.1, §4.9.3, §4.12.2, §4.12.3, §10.2, §10.7; [DEBUGGING.md](../DEBUGGING.md); `docs/BUGS/` |
| **Covers** | `§10.2`; the two `[consumer]` ledger titles named in steps 14.4 and 14.5 |

## Steps

Run the steps in number order. Each one is its own task and branch.

- [ ] **14.1** Fix BUG-0080 first: it turns `npm run lint` red after every task write, which taxes every later step.
  - **Task:** `fix`, branch `fix/14-task-record-format`.
  - **Do:** follow DEBUGGING.md. Write the regression test red, then make CLI-written task and review records pass the formatter unedited. SPEC §4.1 owns the record format; if the fix changes that format, change SPEC first.
  - **Verify:** create a task on a scratch branch with `npx codictator task new`, then `npm run lint` exits 0 with no hand edit.
- [ ] **14.2** Fix BUG-0079: `commit-msg` must honour the merge-commit exemption of SPEC §4.9.3.
  - **Task:** `fix`, branch `fix/14-merge-commit-exempt`.
  - **Do:** regression test first: a merge commit whose second parent carries its own history entry passes, and a normal commit without an entry still blocks.
  - **Verify:** the regression test is green; a local `git merge --no-ff` of a recorded branch commits.
- [ ] **14.3** Fix BUG-0083: L4 `core/history-entry` must count one entry per non-merge commit in the range.
  - **Task:** `fix`, branch `fix/14-history-per-commit`.
  - **Do:** regression test first, on a three-commit range where one commit has no entry of its own. Expect one finding naming that commit.
  - **Verify:** the regression test is green and `npx codictator ci verify` stays green on `main`.
- [ ] **14.4** Turn green `[consumer] every L1-mapped floor rule fires on its hook probe`.
  - **Task:** `feature`, branch `feature/14-consumer-firing-l1`.
  - **Do:** run `node --test packages/codictator/tests/acceptance/consumer-enforcement-firing-l1.test.ts` and list each rule it reports as silent. For each, repair the enforcer, its layer mapping or its probe payload. Never drop a rule from the probe list. Delist the title in the change that makes it pass.
  - **Verify:** `npm test` is green and the title is absent from `packages/codictator/tests/red-ledger.json`.
  - **Stop:** more silent rules than one session can fix. Split by rule family, one task each, and keep this step unticked until the last lands.
- [ ] **14.5** Turn green `[consumer] every L3/L4-mapped floor rule fires on its gate probe`.
  - **Task:** `feature`, branch `feature/14-consumer-firing-l34`.
  - **Do:** as step 14.4, with `consumer-enforcement-firing-l34.test.ts` and the git-hook and `ci verify` probes.
  - **Verify:** as step 14.4, for this title.
- [ ] **14.6** Turn green the five `[§10.2] fixture repo <name> builds into temp git repo` titles.
  - **Task:** `feature`, branch `feature/14-fixture-goldens`.
  - **Do:** run `node --test packages/codictator/tests/acceptance/repos-goldens.test.ts`. The names are `ts-clean`, `ts-brownfield`, `python`, `dotnet` and `mixed`. A missing fixture is built per SPEC §10.2. A product defect gets a `docs/BUGS/` row and its own `fix` task before this step continues.
  - **Verify:** `npm run ledger -- --covers "§10.2"` exits 0.
- [ ] **14.7** Fix BUG-0087: a `docs` task that touches code files must be reclassified as code.
  - **Task:** `fix`, branch `fix/14-docs-reclassify`.
  - **Do:** follow DEBUGGING.md. Write the regression test red: a `docs` task that writes a code file still owes the red and green proofs (SPEC §4.12.2). Then make the phase gate judge the touched files, not only the declared type.
  - **Verify:** the regression test is green and a `docs` task that writes only docs still advances without proofs.
- [ ] **14.8** Make `README.md` state what ships.
  - **Task:** `docs`, branch `docs/14-readme-truth`.
  - **Do:** set the status version to the `version` field of `packages/codictator/package.json`. Run `npx codictator pack list` and make the Languages line agree with it. Check each harness line against the adapter capabilities of SPEC §4.5.
  - **Verify:** fresh-session docs review with zero open findings.
- [ ] **14.9** Ship the fixes as a patch release.
  - **Task:** the tagging path of step 13.8 and SPEC §4.15.5.
  - **Do:** tag only after steps 14.1–14.8 are merged. Human: publish a GitHub Release for the tag, with notes drawn from `docs/HISTORY/`.
  - **Verify:** `gh release view <tag>` shows the notes, and `npm view codictator version` prints the tagged version.

## Exit gate

- `npm run ledger -- --covers "§10.2"` exits 0, and neither `red-ledger.json` lists a title.
- No row of `docs/BUGS/` has the status `open`.
- `npx codictator verify --all` reports zero findings.
- Both required checks are green on all three OSes for the tagged commit.

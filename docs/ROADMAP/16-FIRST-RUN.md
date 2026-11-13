# 16. First Run

**[◀ 15. Consumer Proof](15-CONSUMER-PROOF.md)** · [Roadmap index](../ROADMAP.md) · **[17. Extension Experience ▶](17-EXTENSION-UX.md)**

| | |
|---|---|
| **Depends on** | Phase 14 (may run in parallel with phases 15 and 17) |
| **Delivers** | One command from a bare repo to a first green verify, inside a time budget, with nothing left for the user to look up (PRD §10 "Adoption") |
| **Read** | PRD §5.1, §7.8, §10, §12 #33; SPEC §4.13.1, §4.19.4, §4.19.6, §8, §9.3 |
| **Covers** | The SPEC §4.19 and §9.3 rows added by steps 16.1, 16.2 and 16.5 |

## Steps

- [ ] **16.1** SPEC first: give `setup` a time budget.
  - **Task:** `docs`, branch `docs/16-setup-budget`.
  - **Do:** time `npx codictator setup` on each fixture repo of SPEC §10.2, on all three OSes, with a warm npm cache. Add a SPEC §9.3 row for time from command start to first green verify, set from those timings.
  - **Verify:** fresh-session docs review; the row names its measurement source.
- [ ] **16.2** SPEC first: make `setup` propose what it detects.
  - **Task:** `docs`, branch `docs/16-setup-detection`.
  - **Do:** SPEC §4.13.1 step 1 detects languages and harnesses and proposes packs, while SPEC §4.19.6 installs core rules only without `--pack`. Resolve this in SPEC §4.19.6: `setup` lists the detected packs, harnesses and profile, and the human accepts them all with one key. Flags still override. Add an edge case per detection outcome, including "nothing detected".
  - **Verify:** fresh-session docs review; no sentence of §4.13.1 and §4.19.6 disagrees.
- [ ] **16.3** Write the step 16.1 and 16.2 rows as failing tests, then build them.
  - **Task:** `feature`, branch `feature/16-setup-detection`.
  - **Do:** acceptance tests on the `ts-clean`, `python`, `dotnet` and `mixed` fixtures assert the proposal and the accepted result. A stress test asserts the budget. Enter them red, then implement inside `cli` and `remediation` only.
  - **Verify:** `npm run ledger -- --covers` with the new rows exits 0; `npm run test:stress` is green.
- [ ] **16.4** Every `setup` failure names its one fix.
  - **Task:** `feature`, branch `feature/16-setup-failure-text`.
  - **Do:** for each failure row of SPEC §4.19.6 and each Node prerequisite case of SPEC §4.19.4, assert that stderr holds the error code, one plain sentence and one exact command to run. Write the assertions red first.
  - **Verify:** the new tests are green on all three OSes.
- [ ] **16.5** PRD first: a trial that writes nothing.
  - **Task:** `docs`, branch `docs/16-trial-question`.
  - **Do:** add a PRD §13 question. Working default: a read-only command reports what Codictator would find in any repo, writes no file, and prints the `setup` line. Human: the founder answers; the answer moves to PRD §12. On "yes", add the command to SPEC §4.19 with edge cases, then tests red, then the build, as separate tasks.
  - **Verify:** PRD §13 no longer lists the question; on "yes", `npm run ledger -- --covers` with the new rows exits 0.
  - **Stop:** the founder answers "no". Tick the step in the docs change that records the decision.
- [ ] **16.6** Prove that leaving is clean.
  - **Task:** `feature`, branch `feature/16-uninstall-proof`.
  - **Do:** add an acceptance test: `setup` then `npx codictator uninstall` on the `ts-clean` fixture. Only the `guardrail` record and the documented CI notice remain, and `git status` lists no stray file.
  - **Verify:** the test is green on all three OSes.
- [ ] **16.7** Test the README install section as written.
  - **Task:** `feature`, branch `feature/16-readme-quickstart-test`.
  - **Do:** add an acceptance test that reads the fenced commands under the README "Install" heading and runs them, in order, on a fresh copy of the `ts-clean` fixture. The human-only `setup` runs through the test harness's human stand-in. Network access follows SPEC §10.2.
  - **Verify:** the test is green; editing a README command to a wrong one turns it red.
- [ ] **16.8** Human: first-run trial with three developers who have never seen Codictator.
  - **Do:** each gets only the README and a repo of their own. Note every question, hesitation and error. File each as an issue; a defect gets a `docs/BUGS/` row.
  - **Verify:** all three reach a green `verify` unaided, and no issue from the trial is open.

## Exit gate

- `npm run test:stress` shows `setup` inside the step 16.1 budget on all three OSes.
- `npm run ledger -- --covers` with every row this phase added exits 0.
- The step 16.8 trial passed with no open issue.

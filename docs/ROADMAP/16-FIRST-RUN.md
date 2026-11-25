# 16. First Run

**[◀ 15. Consumer Proof](15-CONSUMER-PROOF.md)** · [Roadmap index](../ROADMAP.md) · **[17. Extension Experience ▶](17-EXTENSION-UX.md)**

| | |
|---|---|
| **Depends on** | Phase 14 (may run in parallel with phases 15 and 17) |
| **Delivers** | One command from a bare repo to a first green verify, inside a time budget, with nothing left for the user to look up (PRD §10 "Adoption") |
| **Read** | PRD §5.1, §7.8, §10, §12 #33; SPEC §4.13.1, §4.19.4, §4.19.6, §8, §9.3 |
| **Covers** | The SPEC §4.19 and §9.3 rows added by steps 16.1, 16.2 and 16.5 |

## Steps

- [x] **16.0a** SPEC and PRD first: agents may run `setup`.
  - **Task:** `docs`, branch `docs/setup-agent-allowed`.
  - **Do:** record PRD §12 #40; narrow the human-only rule of SPEC §4.19.2 and §4.19.6 to `setup --repair` over an existing config; add `--yes` and SPEC §4.19.7 EC-11..15; widen the uninstall shapes of SPEC §4.14.3.
  - **Verify:** fresh-session docs review; no doc still calls `setup` human-only.
- [x] **16.0b** Build the setup-agent-allowed change.
  - **Task:** `feature`, branch `fix/setup-agent-allowed`.
  - **Do:** tests for SPEC §4.19.7 EC-11..15 and the widened SPEC §4.14.3 uninstall shapes, entered red, then the gate, the `--yes` flag and the shell-guard change inside `cli` and `integrity` only.
  - **Verify:** `npm run ledger -- --covers "§4.19 EC-11..15" "§4.14 EC-13..14"` exits 0; the always-set is green.
- [x] **16.0c** SPEC first: the empty-packs message lists every built-in pack, and the shell-guard wording for `setup` is exact.
  - **Task:** `docs`, branch `fix/setup-agent-allowed`.
  - **Do:** rewrite the empty-packs paragraph of SPEC §4.19.6 so the message is generated from the built-in pack ids of SPEC §4.4.2 except `core`; reword SPEC §4.19.6, §4.14.3 and §4.2.3 to say the shell guard does not match `setup` and the CLI gate refuses `--repair` over an existing config.
  - **Verify:** fresh-session docs review; no doc hardcodes `--pack typescript` as the only language pack.
- [x] **16.0d** Build the setup empty-packs message from the built-in pack ids.
  - **Task:** `feature`, branch `fix/setup-agent-allowed`.
  - **Do:** a test traced to SPEC §4.19.6 entered red, then `setup` loops over the built-in pack ids for the repair lines and the fresh hint, inside `cli` only.
  - **Verify:** the test is green; adding a built-in pack id changes the message with no text edit.
- [x] **16.0e** SPEC and PRD first: the `upgrade` command.
  - **Task:** `docs`, branch `feat/upgrade-command`.
  - **Do:** record PRD §12 #41; add the SPEC §4.19.2 row, §4.19.7 EC-16..21 and §4.19.8; add `CDX-E012` to SPEC §8.1; note the config exception in SPEC §4.2 and the bot rule in SPEC §4.8.6.
  - **Verify:** fresh-session docs review; no doc calls `config.codictator` human-edit-only without the `upgrade` exception.
- [x] **16.0f** Build `upgrade`.
  - **Task:** `feature`, branch `feat/upgrade-command`.
  - **Do:** tests for SPEC §4.19.7 EC-16..21 entered red, then the command inside `cli` reusing the setup install helpers; the install must not match the uninstall shapes of SPEC §4.14.3.
  - **Verify:** `npm run ledger -- --covers "§4.19 EC-16..21"` exits 0; the always-set is green.
- [x] **16.0g** Fix BUG-0119: regen leaves untracked harness files.
  - **Task:** `fix`, branch `fix/regen-untracked-files`.
  - **Do:** a test traced to SPEC §4.14.1 entered red, then `regen` leaves no untracked, ungitignored harness file in this repo.
  - **Verify:** the test is green; BUG-0119 is fixed with its regression test.
- [x] **16.0h** Fix BUG-0120: the prompt hook fails closed with CDX-E904.
  - **Task:** `fix`, branch `fix/prompt-hook-e904`.
  - **Do:** a test traced to SPEC §4.5 entered red, then the `prompt` trigger has an effective enforcer or no installed hook; confirm the scope for consumer repos first.
  - **Verify:** the test is green; BUG-0120 is fixed with its regression test.
- [ ] **16.0i** Fix BUG-0121: the no-guard-removal false positive.
  - **Task:** `fix`, branch `fix/guard-removal-false-positive`.
  - **Do:** a test traced to SPEC §4.7.1 entered red, then `removedGuards` tells a changed assert from a weakened one.
  - **Verify:** the test is green; BUG-0121 is fixed with its regression test.
- [ ] **16.0j** SPEC first: a light workflow path for docs-only and bug-row changes.
  - **Task:** `docs`, branch `docs/light-workflow-path`.
  - **Do:** state in SPEC §4.12.2 that a docs-only or bug-row-only change skips the test phases and the separate review round; add the edge cases.
  - **Verify:** fresh-session docs review; no sentence of SPEC §4.12 and docs/AGENTIC_WORKFLOW.md disagrees.
- [ ] **16.0k** Fix BUG-0122 and BUG-0123.
  - **Task:** `fix`, branch `fix/task-close-and-explain-e401`.
  - **Do:** tests traced to SPEC §4.12.1 and §8.1 entered red, then `task close` keeps the committed task record, and the CDX-E401 explain text is widened to match SPEC §8.1 without tripping core/duplication.
  - **Verify:** the tests are green; BUG-0122 and BUG-0123 are fixed with regression tests.
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
  - **Do:** add an acceptance test that reads the fenced commands under the README "Install" heading and runs them, in order, on a fresh copy of the `ts-clean` fixture. `setup` runs with `--yes`. Network access follows SPEC §10.2.
  - **Verify:** the test is green; editing a README command to a wrong one turns it red.
- [ ] **16.8** Human: first-run trial with three developers who have never seen Codictator.
  - **Do:** each gets only the README and a repo of their own. Note every question, hesitation and error. File each as an issue; a defect gets a `docs/BUGS/` row.
  - **Verify:** all three reach a green `verify` unaided, and no issue from the trial is open.

## Exit gate

- `npm run test:stress` shows `setup` inside the step 16.1 budget on all three OSes.
- `npm run ledger -- --covers` with every row this phase added exits 0.
- The step 16.8 trial passed with no open issue.

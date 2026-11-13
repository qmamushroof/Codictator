# 17. Extension Experience

**[◀ 16. First Run](16-FIRST-RUN.md)** · [Roadmap index](../ROADMAP.md) · **[18. Launch ▶](18-LAUNCH.md)**

| | |
|---|---|
| **Depends on** | Phase 14 (may run in parallel with phases 15 and 16) |
| **Delivers** | An extension a newcomer understands without documentation: reviewed views, plain states, a short path from finding to fix, an accessible UI and a complete store listing |
| **Read** | PRD §7.10, §12 #2, #22, #24; SPEC §4.20, §7.15, §9.2, §10.2 |
| **Covers** | The SPEC §4.20 rows added by step 17.2 |

## Steps

- [ ] **17.1** Review the six views on a real repo.
  - **Task:** no tracked write; a read-only review session.
  - **Do:** open this repo and the `ts-brownfield` fixture in VS Code. For each view of SPEC §4.20.2, record what a newcomer cannot understand, cannot reach by keyboard, or cannot act on. Include the empty, connecting, error and retrying states. Return the findings in the shape of SPEC §7.16.
  - **Verify:** every view and every state has at least one recorded observation or the word "clear".
- [ ] **17.2** SPEC first: turn the accepted findings into SPEC §4.20 rows.
  - **Task:** `docs`, branch `docs/17-extension-ux-spec`.
  - **Do:** Human: the founder accepts or rejects each finding. For each accepted one, add or amend a SPEC §4.20 row or edge case. Required rows: each state shows one plain sentence and one next action; a Violations item reaches `explain` and its remediation in one action; a first-open orientation that needs no documentation. The extension still does nothing the CLI refuses (PRD §12 #22).
  - **Verify:** fresh-session docs review.
- [ ] **17.3** Write the step 17.2 rows as failing extension tests.
  - **Task:** `feature`, branch `feature/17-extension-ux-red`.
  - **Do:** unit tests with the fake `vscode` API under `packages/vscode/tests/`, plus host assertions in `packages/vscode/tests/e2e/` where a row needs a real window. Enter each in `packages/vscode/tests/red-ledger.json`.
  - **Verify:** `npm test` is green with the new titles listed.
- [ ] **17.4** Build the rows, one view per task.
  - **Task:** `feature`, branch `feature/17-view-<name>` (for example `feature/17-view-violations`).
  - **Do:** change `packages/vscode/` only. A row that needs new engine data goes to SPEC §7.15 first.
  - **Verify:** `npm run test:extension` is green and `npm run ledger -- --covers "§4.20"` exits 0.
- [ ] **17.5** Accessibility pass.
  - **Task:** `feature`, branch `feature/17-accessibility`.
  - **Do:** every tree item gets an accessible label and a tooltip. Every action is reachable from the keyboard and the command palette. Colour comes only from theme tokens, and no meaning is carried by colour alone. Assert the labels in unit tests.
  - **Verify:** the tests are green; a keyboard-only walk through all six views completes.
- [ ] **17.6** Complete the store listing.
  - **Task:** `feature`, branch `feature/17-store-listing`.
  - **Do:** in `packages/vscode/`, write the listing README with one sentence of value, the setup action and one screenshot per view. Set `categories`, `keywords`, `icon` and the gallery banner in `package.json`. Extend the packaging test to assert that these fields and files exist in the `.vsix`.
  - **Verify:** `npm run test:packaging` is green.
- [ ] **17.7** Human: usability test with three newcomers.
  - **Do:** each installs the extension in a repo of their own. Tasks: set up, find why a change was blocked, open the rule's explanation, find the current budget band. Note each failure and file it as an issue.
  - **Verify:** all three finish the four tasks unaided, and no issue from the test is open.

## Exit gate

- `npm run test:extension` and `npm run test:packaging` are green on all three OSes.
- `npm run ledger -- --covers "§4.20"` exits 0.
- The step 17.7 test passed with no open issue.

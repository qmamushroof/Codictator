# 13. Release

**[◀ 12. P1 Scope](12-P1-SCOPE.md)** · [Roadmap index](../ROADMAP.md) · **(last)**

| | |
|---|---|
| **Depends on** | Phases 11 and 12 (or 12 cut) |
| **Delivers** | The first published release of `codictator` on npm and `codictator.codictator-vscode` on the VS Code Marketplace and Open VSX |
| **Read** | SPEC §4.15.5, §9, §10.2, §10.4–§10.6, §11 S28; PRD §9, §10 |
| **Covers** | `§10.2`, `§10.4`, `§10.5`, and every remaining ledger entry not belonging to a cut P1 item |

## Steps

- [ ] **13.1** Determinism across OSes: CI compares the verdict JSON of every acceptance scenario between Linux, Windows and macOS, and replays every event the suite produced (SPEC §10.4). Verify: the comparison job is green.
- [ ] **13.2** All stress rows of SPEC §10.5 within budget on the 10,000-file reference repo. Verify: `npm run test:stress`.
- [x] **13.3** Packaging: tarball allowlist, no `node_modules` in the `.vsix`, no install scripts. Verify: `npm run test:packaging`.
- [ ] **13.4** Scheduled `live` job checking real registry and OSV shapes and harness-capture freshness, opening an issue on drift; never a merge gate (SPEC §10.6). Verify: one manual dispatch is green.
- [ ] **13.5** Release workflow: tags only, full verify first, npm trusted publishing with provenance, `vsce` and `ovsx` publishing (SPEC §4.15.5, §9.2). Verify: a dry run on a pre-release tag.
- [ ] **13.6** Human: claim the `codictator` npm package and publisher ids, configure trusted publishing (Marketplace uses OIDC, no token) and the `OVSX_PAT` repository secret (SPEC §4.15.5). Verify: the release workflow's preflight step.
- [ ] **13.7** `README.md` status and install sections match what ships, including each adapter's declared gaps. Verify: fresh-session docs review.
- [ ] **13.8** Tag the release. Verify: `npx codictator@<version> init` on each fixture repo turns green on all three OSes; the extension installs from both marketplaces.

## Exit gate

- The red ledger holds nothing but tests of cut P1 items, and the SPEC-trace completeness test is green.
- Every check required on `main` is green; `npx codictator verify --all` reports zero findings.
- The published packages carry npm provenance and match the tagged commit.

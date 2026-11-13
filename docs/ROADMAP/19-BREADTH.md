# 19. Breadth

**[◀ 18. Launch](18-LAUNCH.md)** · [Roadmap index](../ROADMAP.md) · **(last)**

| | |
|---|---|
| **Depends on** | Phase 18 |
| **Delivers** | The PRD §9.2 items, each pulled in when recorded demand asks for it |
| **Read** | PRD §9.2, §12 #32, #36; SPEC §1.6, §4.5.6, §4.15.6, §6 |
| **Covers** | The SPEC rows each step's SPEC change adds |

## How an item starts

Every step follows the same five moves, each its own task:

1. **Entry:** Human: the founder confirms demand from the phase 18 issues and reach numbers.
2. **PRD first:** move the item from PRD §9.2 to §9.1 with its priority, as a `docs` task.
3. **SPEC first:** add its module rows, edge cases and stress rows, as a `docs` task.
4. **Red:** write every new row as a failing test in the ledger.
5. **Green:** build it, delist the tests, and extend the README in the same change.

## Steps

- [ ] **19.1** Generated CI for a second host (PRD §12 #36).
  - **Task:** branches `docs/19-ci-host-<name>`, then `feature/19-ci-host-<name>`.
  - **Verify:** the generated workflow gates a merge on a fixture repo hosted there.
- [ ] **19.2** Native harness adapters beyond the first release, one per task, in order of request count.
  - **Task:** branch `feature/19-adapter-<harness>`.
  - **Do:** start from a first-party capture (SPEC §4.5.7). Declare every gap in the capability table.
  - **Verify:** `npx codictator adapter test <id>` is green.
- [ ] **19.3** Language packs beyond the first release, one per task, in order of request count.
  - **Task:** branch `feature/19-pack-<language>`.
  - **Do:** each pack ships its driver, extractor, measures, fixtures and a fixture repo under SPEC §10.2.
  - **Verify:** `npx codictator pack test <id>` is green and the phase 15 scenarios pass on its fixture repo.
- [ ] **19.4** Pack-listed codemods in dependency-major chains (SPEC §1.6 "Later").
  - **Task:** branch `feature/19-codemods`.
  - **Do:** the item is already in SPEC §1.6, so skip the PRD move of the entry moves and start at SPEC first.
  - **Verify:** a `dep-major` step on the `ts-brownfield` fixture completes with no agent task.
- [ ] **19.5** Organisation-wide policy across many repos.
  - **Stop:** PRD §9.2 names an unsolved distribution question. Raise it in PRD §13 and wait for the founder's answer before any SPEC work.
- [ ] **19.6** Community pack registry.
  - **Stop:** PRD §9.2 names an unsolved trust and signing model. Raise it in PRD §13 and wait for the founder's answer.
- [ ] **19.7** Editors outside the VS Code family.
  - **Task:** branch `feature/19-editor-<name>`.
  - **Do:** reuse the stdio protocol of SPEC §7.15 unchanged; the new client holds no rule logic.
  - **Verify:** the client shows the same three P0 views against this repo.

## Exit gate

- Every started item has its PRD, SPEC, red and green changes merged, or is named in the release notes as not started.
- `npx codictator verify --all` reports zero findings.

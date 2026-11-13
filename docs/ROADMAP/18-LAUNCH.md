# 18. Launch

**[◀ 17. Extension Experience](17-EXTENSION-UX.md)** · [Roadmap index](../ROADMAP.md) · **[19. Breadth ▶](19-BREADTH.md)**

| | |
|---|---|
| **Depends on** | Phases 14–17 |
| **Delivers** | A public surface that shows the product working in under a minute, a feedback loop, and tracked reach (PRD §10 "Reach") |
| **Read** | PRD §1.1, §4.2, §5.1, §10, §12 #11; SPEC §4.9.2, §4.15.5; [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| **Covers** | No new SPEC rows; this phase moves PRD §10 "Reach" and "Precision" |

No plan guarantees reach. This phase delivers the conditions for it: a visitor understands, tries and trusts the product without help.

## Steps

- [ ] **18.1** A reproducible demo.
  - **Task:** `feature`, branch `feature/18-demo-script`.
  - **Do:** add a script under `packages/codictator/scripts/` that builds the `ts-clean` fixture in a temp folder, replays one hostile hook payload, and prints the block with its compliant alternative. It uses no network and no LLM. Add an acceptance test that runs it, so CI covers it. Human: record the script's terminal run as a short clip, well under the `core/max-file-bytes` limit of SPEC §5.6.
  - **Verify:** the script exits 0 on all three OSes and prints the same text each run.
- [ ] **18.2** Rewrite the top of `README.md` for a first-time visitor.
  - **Task:** `docs`, branch `docs/18-readme-hero`.
  - **Do:** order the top as: one sentence of value, the step 18.1 clip, the one `setup` command, then three lines on what happens next. Keep every fact owned elsewhere as a link. The step 16.7 test must stay green.
  - **Verify:** fresh-session docs review; a reader states what the product does after reading the first screen only.
- [ ] **18.3** Human: complete the GitHub repository surface.
  - **Do:** set the homepage URL, the social preview image and the topics. Publish a GitHub Release with notes for every tag from this point on. Enable Discussions. Agent: add the false-positive and harness-request issue forms to the existing bug and feature forms under `.github/ISSUE_TEMPLATE/`, through the guardrail change path of SPEC §4.14 where those files are owned.
  - **Verify:** `gh repo view --json homepageUrl` is non-empty; each new issue form opens.
- [ ] **18.4** Make a first contribution easy.
  - **Task:** `docs`, branch `docs/18-first-contribution`.
  - **Do:** follow CONTRIBUTING.md literally in a fresh session and fix every step that fails or is missing. Human: label at least five small, well-specified issues for newcomers.
  - **Verify:** a fresh session lands a trivial docs fix using only CONTRIBUTING.md.
- [ ] **18.5** Human: announce.
  - **Do:** the founder chooses the venues and posts. Each post leads with the clip and the one command, and states the limits honestly (PRD §4.2). An agent may draft text, kept out of the tracked tree.
  - **Verify:** each post links the repository and the two store listings.
- [ ] **18.6** Run the feedback loop for four weeks after step 18.5.
  - **Do:** answer every issue within two working days. A false-positive report becomes a `docs/BUGS/` row with a fixture and its own `fix` task. A feature request becomes a PRD §13 question or is declined with a reason.
  - **Verify:** no issue older than two working days lacks an answer; no false-positive row is `open` for more than one release.
- [ ] **18.7** Track reach weekly.
  - **Do:** Human: read npm weekly downloads and the install counts of both stores, the PRD §10 "Reach" sources. Post the numbers in one pinned GitHub issue, never in a tracked file. Product code collects nothing (PRD §12 #11).
  - **Verify:** the pinned issue has four consecutive weekly entries.

## Exit gate

- The demo script of step 18.1 is green in CI on all three OSes.
- The README first screen passed the step 18.2 review.
- Steps 18.6 and 18.7 each completed four weeks.
- The founder decides from the step 18.7 numbers which phase 19 item starts first.

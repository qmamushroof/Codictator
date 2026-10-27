# 10. Self-Host

**[◀ 9. Guardrail Generation](09-GUARDRAIL-GENERATION.md)** · [Roadmap index](../ROADMAP.md) · **[11. Extension ▶](11-EXTENSION.md)**

| | |
|---|---|
| **Depends on** | Phase 9 |
| **Delivers** | Codictator governing its own repo with the same floor as any target (PRD §6 P11); bootstrap mode retired |
| **Read** | SPEC §4.13.1, §4.14, §4.15.5, §7.1, §7.2, §3.3; [AGENTIC_WORKFLOW.md §Modes](../AGENTIC_WORKFLOW.md#modes); [LOCAL_SETUP.md](../LOCAL_SETUP.md) |
| **Covers** | No new SPEC rows; this phase proves PRD §10 "Credibility" |

## Steps

- [ ] **10.1** Human: `npx codictator init` with profile `app`, the SPEC §3.3 module map, packs `core` and `typescript`, and harnesses `opencode`, `muse-code` and `claude-code` (plus any other a contributor uses). Verify: `.codictator/config.json` and the manifest are committed.
- [ ] **10.2** The baseline is empty: a greenfield repo carries no recorded debt. Every finding of the first `verify` is fixed, never baselined. Verify: `.codictator/baseline.json` has no entries.
- [ ] **10.3** Helpers declared in `config.tools` at exact pins found by lookup: a knowledge-graph tool and a token saver (`core/agent-assets-present`). Verify: `npx codictator status` shows both present.
- [ ] **10.4** The generated `codictator.yml` runs beside the test matrix, and its `verify` job is added to the required checks of `main` (SPEC §4.15.5). Verify: both checks required and green.
- [ ] **10.5** `AGENTS.md` carries the managed block. The hand-written part keeps only the map and what the block does not own, so nothing is stated twice (`core/doc-single-owner`). Verify: `npx codictator verify --all`.
- [ ] **10.6** Docs change retiring bootstrap mode in [AGENTIC_WORKFLOW.md](../AGENTIC_WORKFLOW.md) and [VALIDATION.md](../VALIDATION.md); history entries from here on name a `T-####` task. Verify: fresh-session review of the docs change.
- [ ] **10.7** Dogfood proof on a throwaway branch, in OpenCode with a Meta model. A prompt asking for a hard-coded key in `src/` is steered or blocked at L1; the same key forced in by hand is blocked at L3 and L4. Verify: the three events in `codictator status` and the red PR, then close it.

## Exit gate

- `npx codictator verify --all` reports zero findings and `npx codictator ci verify` is green on `main`.
- `npx codictator status` shows L1 `active` for OpenCode and `unverified` for Muse Code unless a first-party capture is committed.
- Both required checks are green on all three OSes.

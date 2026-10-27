# How to Use the Roadmap

**(first)** · [Roadmap index](../ROADMAP.md) · **[1. Scaffold ▶](01-SCAFFOLD.md)**

## Premise

Codictator is built SPEC-driven ATDD (PRD §12 #7). Phase 2 writes every SPEC edge case and rule row as a failing test, entered in the red ledger (SPEC §10.7). Each later phase turns a named set of those tests green. "Done" is therefore mechanical: a phase's tests are out of the ledger and green, or the phase is not done.

## Phase loop

1. **Enter** a phase only when the previous phase's exit gate is green and all its steps are ticked. Phases 11 and 12 may run in parallel once phase 10 is done; no other overlap.
2. **Discover:** read this file, the phase leaf in full, and every reference on its **Read** line.
3. **Split** the phase into tasks, normally one per step or one per SPEC leaf, each on its own branch. A step is never shrunk to fit a session; it is split.
4. **Run each task** through [AGENTIC_WORKFLOW.md](../AGENTIC_WORKFLOW.md). For phases 3–13 the declared tests are the ledger entries citing the task's SPEC rows.
5. **Tick** a step (`[ ]` → `[x]`) in the commit that completes it, after its verify ran green locally. CI on that commit is the merge gate.
6. **Close** the phase with the exit gate commands. A finding goes to its owning doc or to `docs/BUGS/`; an out-of-scope idea goes to PRD §13 as a question, never into the phase.

## Leaf anatomy

| Section | Contains |
|---|---|
| **Depends on** | Phases that must be done |
| **Delivers** | What exists afterwards that did not before |
| **Read** | SPEC and process docs to read before starting |
| **Covers** | The SPEC rows whose ledger tests this phase turns green; the exit gate passes them to `npm run ledger -- --covers` |
| **Steps** | Numbered checkboxes `N.k`, each with how it is verified |
| **Exit gate** | Mechanical checks, every one a command or an observable state |

## Done

A phase is done when every step is ticked, `npm run ledger -- --covers <Covers rows>` exits 0, the [VALIDATION.md](../VALIDATION.md) always-set is green on all three OSes in CI, and every earlier phase's tests are still green.

## Rules for every phase

- Module order follows the allowed imports of SPEC §3.3: a phase never needs a module a later phase builds. Stubs from phase 2 stand in until then.
- Built-in pack content grows with its consumers. A `typescript` pack supply (extractor, measures, patterns, driver) lands in the phase whose module uses it.
- A fixture test asserts a real finding of its rule, never the fail-closed `CDX-E9xx` finding (SPEC §4.3.8). A stub enforcer must not make a violating fixture pass.
- Stress rows of SPEC §10.5 leave the ledger in the phase that delivers their path; [phase 13](13-RELEASE.md) re-checks them all.
- Bootstrap mode applies until [phase 10](10-SELF-HOST.md) closes ([AGENTIC_WORKFLOW.md §Modes](../AGENTIC_WORKFLOW.md#modes)).

## Scope and cut order

Phases 1–11 and 13 are P0 and are never cut. Phase 12 is P1 and is cut first, item by item, under SPEC §1.6. A cut item's tests stay in the ledger and are named in the release notes.

## Changing the plan

The roadmap changes through a reviewed docs change. A new phase adds its leaf and its router row in the same change. Reordering must still respect SPEC §3.3, and a SPEC-level change goes to SPEC first.

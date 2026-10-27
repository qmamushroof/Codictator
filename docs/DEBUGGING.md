# Debugging

How a defect in Codictator is diagnosed, recorded and fixed. The rules are SPEC §4.9.4 and §5.8; the record grammars are SPEC §7.7.

## Diagnose before fixing

A fix task cannot enter implementation without a diagnosis (`core/diagnose-before-fix`).

1. **Reproduce** with the smallest input: a failing command, a fixture repo, a captured hook payload. A defect that cannot be reproduced is not yet a defect; record what was observed and keep looking.
2. **Find the root cause.** Name the line and the false assumption behind it, not the symptom. Read the event (`codictator explain <eventId>`, `codictator replay <eventId>`) when a verdict is involved.
3. **Check the SPEC.** If the code matches SPEC and SPEC is wrong, the fix starts as a SPEC change in its own docs commit.
4. **Write the regression test** that fails on the unfixed code, titled with the SPEC reference it protects, and enter it in the red ledger (SPEC §10.7). That run is the red proof (`core/regression-test-for-fix`).
5. **Fix** the cause, not the test. The test leaves the ledger in the fixing commit.

Diagnosis is written to the task record (SPEC §7.11 `diagnosis`) once self-hosted, and into the PR description under `Diagnosis` before that.

## The bug registry

- File, row grammar and column values are SPEC §7.7; the rules checking them are SPEC §4.9.4.
- A row is added with status `open` when the defect is found.
- The fixing commit sets it to `fixed`; a decision not to fix sets `wontfix`. Either fills the columns SPEC §7.7 requires, and nothing else in the row changes.
- The fixing commit's history entry carries `Bug: BUG-####` (`core/bug-registry`).

## Found in passing

A defect noticed while working on something else is filed in the same session as an `open` row, then the current task continues. Self-hosted, the `codictator-bug-record` asset does this. It is never fixed silently inside an unrelated change.

## Where to look first

| Symptom | Start at |
|---|---|
| A verdict differs between runs or OSes | `codictator replay <eventId>`; then sorting, `Clock` use and `normalizeText` (SPEC §4.3.6) |
| A hook allowed something it should have blocked | The adapter's capability declaration and its golden payloads (SPEC §4.5.2, §4.5.7) |
| A hook blocked with `CDX-E303` | The raw payload shape logged in the event; capture a fresh one with `codictator adapter capture` |
| `CDX-E9xx` | The enforcer named in the event; its fixture cases first |
| A generated file drifts after `regen` | `stableStringify` use and map ordering in the owning adapter or module |

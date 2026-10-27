# 0. Document Map

**(first)** · [PRD index](../PRD.md) · **[1. Product Identity ▶](01-PRODUCT-IDENTITY.md)**

| Document | Owns |
|---|---|
| `docs/PRD.md` + `docs/PRD/` | *What* Codictator does and *why* — problem, users, scope, principles, rule families, metrics, risks, decisions. No implementation detail. |
| `docs/SPEC.md` + `docs/SPEC/` | *How* it is built — architecture, module boundaries, rule schema, adapter contracts, CLI surface, file formats, every edge case. |
| Pre-development docs (written after the SPEC) | How agents build Codictator itself — workflow, conventions, roadmap, validation, debugging, local setup. |
| `docs/HISTORY/`, `docs/BUGS/` | Records: one history entry per commit, one row per defect. |
| `AGENTS.md` (repo root) | The entry point every agent session reads; routes to the docs above. |

## Conflict order

1. **Decisions log (§12)** outranks every other text; reversing an entry is an explicit amendment to §12 with its reason.
2. **PRD wins on product intent.** A SPEC that contradicts intent is corrected, not the PRD.
3. **SPEC wins on implementation.** The PRD never states a mechanism the SPEC must obey beyond what a principle (§6) requires.
4. **Code that contradicts the SPEC is a defect**, never a silent redefinition of the SPEC.

## Status and style

- **Status:** baseline for development. Open items live only in §13.
- **Style:** a rule, then its reason in one sentence; tables for parallel facts; one fact, one owner — other sections point, never restate.
- **Product-level only.** Names of commands, files, schemas and versions belong to the SPEC; where this PRD names one, it is illustrative.

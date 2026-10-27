# 1. Document Identity

**(first)** · [SPEC index](../SPEC.md) · **[2. Stack ▶](02-STACK.md)**

## 1.1 What the SPEC owns

The SPEC is the single source of truth for *how* Codictator is built: architecture, module boundaries, rule ids and thresholds, file and wire formats, CLI surface, error codes, budgets and edge cases. *What* and *why* stay in the PRD (PRD §0); the SPEC cites PRD sections and never restates them.

It is written for SPEC-driven ATDD (PRD §12 #7): every numbered edge case (`EC-n`) and every rule in §5–§6 becomes a failing test before its implementation exists.

## 1.2 Conflict order

1. PRD §12 decisions, then PRD product intent (PRD §0). A SPEC line that contradicts intent is a SPEC defect.
2. **The SPEC leaf that owns the fact** wins on implementation; the router never wins.
3. Inside the SPEC: §7 owns every format; §5–§6 own every rule id, default and bound; the module leaf (§4.n) owns behaviour. A module leaf that restates a format or a default is stale on that point.
4. §11 decisions record why; if a leaf contradicts a §11 entry, the leaf is fixed or the entry is amended in the same change.
5. Code that contradicts the SPEC is a defect, never a silent redefinition.

## 1.3 Citation format

| Cite | Means |
|---|---|
| `SPEC §4.3` | Module leaf 4.3 |
| `SPEC §4.3.2` | Heading numbered `4.3.2` inside it (`##`, or `###` under a grouping heading) |
| `SPEC §4.3 EC-4` | Edge case 4 of module 4.3; also the prefix of its test title |
| `SPEC §11 S7` | SPEC decision 7 |
| `core/no-secrets` | A rule id (§5, §6) |
| `CDX-E401` | An error code (§8) |
| `PRD §7.5`, `PRD §12 #14` | A PRD section or decision; inside parentheses that open with `PRD`, every following `§` is also a PRD citation |

## 1.4 Change rules

- **One fact, one owner.** Cite, never copy.
- **Ids are append-only:** rule ids, error codes, `EC-n`, `S#`, event kinds, schema versions. A retired id is marked retired, never reused, because old commits and event logs cite it.
- **A new module** adds its leaf `04-NN-NAME.md`, its row in §3.3 and the router in the same change; a module present in code without a row fails Codictator's own architecture check (§4.11).
- **A new rule** adds a row in §5 or §6 with an enforcer and a violating fixture (PRD §6 P3); a rule row without both is invalid.
- **A changed default or bound** is a pack version bump with a recorded reason (PRD §12 #29).
- **Leaves stay under 40 KB**; a leaf that outgrows it splits into router plus leaves.
- No inline history; change history lives in the change records (§4.9).

## 1.5 What the SPEC does not contain

Code (signatures and shapes yes, implementations no) · sequencing and schedules · procedures for contributors (owned by the pre-development docs, PRD §0) · anything derivable from the code.

## 1.6 Scope tiers

SPEC items mapped onto PRD §9.1 priorities; P0 is never cut, P1 is cut first, *Later* keeps the intent outside the first release.

| Tier | SPEC items |
|---|---|
| P0 | §4.1–§4.15, §4.18–§4.19; adapters Muse Code, OpenCode, Universal, Claude Code, Copilot, Codex CLI; `core` and `typescript` packs; npm driver and bot config; extension views Active rules, Violations, Timeline |
| P1 | Adapters Cursor, Gemini CLI; custom adapters (§4.5.6); `dotnet` and `python` packs with their drivers; §4.16 generator and §4.17 llm; extension views Steering, Budget, Health; `core/duplication` and `core/no-speculative-abstraction` (heuristic measures, highest false-positive risk) |
| Later | CI generation for GitLab and other hosts (§4.15.6 covers them meanwhile); pack-listed codemods in dependency-major chains (§4.13.5 step 3 runs as an agent task until then) |

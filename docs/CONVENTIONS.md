# Conventions

Rules for Codictator's own TypeScript and docs. Each cites the SPEC id or rule that owns its threshold; where a rule id is cited, Codictator enforces it on this repo, and review enforces it.

## Placement

- Layout is SPEC §3.1; module ownership and allowed imports are SPEC §3.3. A file whose module is unclear is a design question for SPEC, not a judgement call.
- A module is a folder whose only public file is `index.ts` (`core/arch-public-entry`). Import another module only through its `index.ts`, and only along an edge §3.3 allows (`core/arch-boundaries`).
- A new module needs its SPEC leaf, its §3.3 row and its router row first (SPEC §1.4).
- Tests live under `packages/<pkg>/tests/<kind>/`, never beside source (SPEC §10.2). Shared test helpers and port fakes live in `tests/support/`.
- Harness payload goldens and fixture repos live under `packages/codictator/fixtures/` (SPEC §4.5.7, §10.2).

## Naming

| Thing | Form |
|---|---|
| Files | `kebab-case.ts`; tests `kebab-case.test.ts` (`core/file-naming`, SPEC §6.1) |
| Types and interfaces | `PascalCase`, no `I` prefix |
| Functions, variables, object keys | `camelCase` |
| Closed sets of values | String-literal unions, with an `as const` object when the values must be iterated |
| Rule ids, error codes, event kinds | Only ids that exist in SPEC §5, §6, §7.10 or §8. A new one is added to SPEC first |
| Exports | Named only; no default exports |

## Size

File, function, complexity and module limits are `core/file-size`, `core/function-size`, `core/complexity` and `core/arch-module-size` (SPEC §5.6, §5.7). Split along responsibilities, never mechanically at the line limit. A function that needs a comment to separate its stages is several functions.

## TypeScript

- The compiler contract is SPEC §3.5; `tsconfig.base.json` is never loosened (`core/compiler-strict`). Erasable syntax only.
- Relative imports carry the `.ts` extension; type-only imports use `import type`.
- No `any`. Take `unknown` and narrow it, or validate it with the kernel schema validator.
- No non-null assertion (`!`) and no `as` cast that widens what the compiler knows. Narrow with a check instead.
- `JSON.parse` only through the kernel's `parseJson`; every generated JSON file through `stableStringify` (SPEC §4.1.2).

## Errors

- Expected failures return `Result<T>` with a `CdxError` whose code exists in SPEC §8 and whose remediation says what to do next.
- `throw` is for programmer errors only. The hook runtime turns an uncaught error into a block (SPEC §4.19.3), so a throw never becomes an allow.
- Every error path fails closed (PRD §12 #12). No empty `catch`, no catch that logs and continues, no default-allow branch.
- Never put file content, prompt text, tool output or a secret in an error, message or event (SPEC §4.18.1, §9.2).

## Determinism and I/O

- Only `kernel` touches the OS, network, clock or randomness (SPEC §3.3 hard boundaries). Every other module takes ports as parameters.
- Time comes from the `Clock` port; never `Date.now()`, a bare `new Date()` or `Math.random()` outside the kernel (SPEC §10.3).
- Iterate maps, sets and file lists in sorted order. Hash text only after `normalizeText` (SPEC §4.3.6, §4.1.2).
- Adapters are pure functions (SPEC §4.5.1). Regeneration with unchanged input is byte-identical.
- Agent-facing text stays inside its byte budget (SPEC §4.3.7, §4.6.2, §4.6.3).

## Dependencies

- Runtime dependencies: none, in both packages (SPEC §11 S2). Development dependencies: only the SPEC §2.2 list.
- Climb the reuse ladder of PRD §8 F6 before adding anything: kernel utility, then Node built-in, then an existing dev dependency.
- Adding or upgrading a dependency changes SPEC §2 in the same change. The version comes from a registry lookup under SPEC §4.8.3; it is pinned exactly and recorded on a `Deps:` history line (`core/dep-exact-pin`, `core/dep-new-needs-reason`).
- Install with `npm ci --ignore-scripts`; the lockfile is committed (`core/dep-lockfile`).

## Tests

- Every test title starts with the SPEC reference it proves, in the form of SPEC §10.1 (`core/spec-trace`). One `EC-n` or one fixture case per test.
- Unit tests use fake ports from `tests/support/`; Node's built-in `node:test` mocks are allowed, no other mocking library.
- No test reaches the public network; registry and LLM traffic goes to a local server on 127.0.0.1 (SPEC §10.2).
- No real sleeps or wall-clock waits: inject a fixed `Clock`. Temporary directories and git repos are created per test and removed after it.
- Never skip, focus, loosen or delete a test, assertion or fixture to turn a run green (SPEC §5.5). A wrong test is an integrity exception the reviewer acknowledges.
- Every rule ships violating and passing fixtures in its pack (SPEC §4.4.1); a rule test without both is incomplete.

## Comments

- Comments say why, never what. A comment that restates the code is deleted.
- Code implementing a SPEC rule whose reason is not obvious cites it, for example `// SPEC §4.3.5: renames move keys`.
- No commented-out code. No `TODO`: open work is a roadmap step or a bug row.
- No lint, type or coverage suppression of any kind (`core/no-new-suppressions`).

## Anti-patterns

| Do not | Instead | Rule |
|---|---|---|
| Add an interface or abstract class with one implementation | Use the concrete type; interfaces exist only at ports and the SPEC §3.4 contracts | `core/no-speculative-abstraction` |
| Leave an export nobody imports | Delete it | `core/dead-code` |
| Re-implement a kernel utility or a Node built-in | Call the existing one | `core/dep-one-per-capability`, PRD §8 F6 |
| Delete a guard, throw or validation to shrink a change | Keep it; a smaller change is never a less safe one | `core/no-guard-removal` |
| Pass boolean flags that switch a function's behaviour | Two functions | `core/complexity` |
| Keep module-level mutable state | Pass state explicitly; caches live behind the kernel `Fs` port | SPEC §4.3.6 |
| Re-export across modules beyond `index.ts` | Import from the owning module's entry | `core/arch-public-entry` |

## Documentation

- Doc layout, size, density and link rules are SPEC §4.9.2 and §5.10; they apply to every doc here.
- PRD owns product truth, SPEC owns technical truth, and the docs routed from [AGENTS.md](../AGENTS.md) own process. Each fact has one owner; everyone else cites it (SPEC §1.4).
- SPEC ids are append-only: rule ids, error codes, `EC-n`, `S#`. Retire, never reuse.
- A code change that alters behaviour updates its SPEC leaf in the same change, or it is a defect (SPEC §1.2).
- No dates of edits, no "updated" notes and no change logs inside docs; the history entry carries them (`core/doc-no-inline-changelog`).

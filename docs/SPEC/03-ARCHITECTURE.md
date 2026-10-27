# 3. Architecture

**[◀ 2. Stack](02-STACK.md)** · [SPEC index](../SPEC.md) · **[4.1 kernel ▶](04-01-KERNEL.md)**

Feature-based clean modular monolith (PRD §12 #5, #25), one engine for every surface (PRD §7.1). Codictator's repo runs under its own `app` profile (§4.11.1), so every boundary below is checked by Codictator itself (PRD §6 P11).

## 3.1 Repository layout

```
package.json                 private root: npm workspaces ["packages/*"], devDependencies (§2.2), scripts
tsconfig.base.json           strict contract (§3.5)
biome.json
.codictator/                 Codictator's own guardrails (§7.1)
docs/                        PRD, SPEC, pre-development docs, HISTORY, BUGS
packages/
  codictator/                npm package "codictator": engine + CLI
    package.json             bin: { "codictator": "dist/cli/main.js" }, type: module, zero dependencies
    schema/                  JSON Schemas of every §7 format
    src/
      kernel/                §4.1
      features/<module>/     §4.2–§4.18; each exposes index.ts only
      builtin-packs/<pack>/  core, typescript, dotnet, python (§4.4, §5, §6)
      cli/                   §4.19 composition root
    tests/{unit,acceptance,integration,architecture,stress}/
    fixtures/                harness payload goldens, fixture repos
  vscode/                    extension "codictator-vscode" (§4.20)
```

Tests sit beside the package, not beside each source file, so the size and placement rules treat `src/` as production code only.

## 3.2 Packages

| Package | Publishes to | Contents | Depends on |
|---|---|---|---|
| `codictator` | npm | Engine, built-in packs, adapters, CLI, stdio server | nothing at runtime |
| `codictator-vscode` | VS Code Marketplace, Open VSX (publisher `codictator`, §11 S28) | Thin client (PRD §12 #2) | nothing at runtime; talks to the **repo-pinned** `codictator` over stdio (§11 S6) |

## 3.3 Modules and allowed dependencies

Every module is a folder with one public file, `index.ts`. Importing any other file of another module is a boundary violation. Cycles are forbidden. "→" lists the only modules it may import.

| § | Module | Path | Owns | → may import |
|---|---|---|---|---|
| 4.1 | kernel | `src/kernel` | Ports, results, errors, hashing, paths, schema validator, secret redaction | Node built-ins only |
| 4.2 | config | `src/features/config` | Config load, validate, tighten | kernel |
| 4.3 | engine | `src/features/engine` | Rule model, evaluation, verdicts, waivers, ratchet | kernel, config, audit |
| 4.4 | packs | `src/features/packs` | Pack loading, self-test, external tools | kernel, config, engine |
| 4.5 | adapters | `src/features/adapters` | Rendering per harness, hook I/O translation | kernel, config, engine, steering |
| 4.6 | steering | `src/features/steering` | Context rendering, budgets, read cache | kernel, config, engine, workflow |
| 4.7 | security | `src/features/security` | Secret, shell, path enforcers | kernel, engine |
| 4.8 | deps | `src/features/deps` | Dependency enforcers, bot config, upgrades | kernel, config, engine |
| 4.9 | records | `src/features/records` | Doc checks, history, bug registry | kernel, engine |
| 4.10 | testing | `src/features/testing` | SPEC trace, red proof, classifier, integrity | kernel, config, engine |
| 4.11 | arch | `src/features/arch` | Profiles, import graph, boundary checks | kernel, config, engine |
| 4.12 | workflow | `src/features/workflow` | Phases, tasks, review, loop breaker | kernel, config, engine, testing, audit |
| 4.13 | remediation | `src/features/remediation` | Baseline, remediation plan, step runner | kernel, config, engine, deps, arch, workflow |
| 4.14 | integrity | `src/features/integrity` | Manifest, drift, self-protection | kernel, config, engine |
| 4.15 | ci | `src/features/ci` | CI workflow generation and CI checks | kernel, config, engine |
| 4.16 | generator | `src/features/generator` | Draft custom packs | kernel, config, packs, llm |
| 4.17 | llm | `src/features/llm` | Provider-agnostic completion client | kernel |
| 4.18 | audit | `src/features/audit` | Event log, explain, summaries | kernel |
| — | builtin-packs | `src/builtin-packs/<pack>` | Rule data binding enforcers | kernel, engine, security, deps, records, testing, arch, workflow, integrity, steering, ci |
| 4.19 | cli | `src/cli` | Composition root, commands, hook entry, server | everything |

**Hard boundaries** (architecture tests, §10.3):

| Boundary | Reason |
|---|---|
| Only `generator` and `cli` may import `llm` | No LLM in any enforcement path (PRD §6 P1) |
| Only `kernel` may import `node:fs`, `node:child_process`, `node:net`, `node:http(s)`, `node:dns`, or use global `fetch` | One place enforces write confinement and the network allowlist (PRD §6 P8) |
| No module reads the clock or randomness except through the kernel `Clock` port | Determinism and replay (§4.3.6) |
| `engine` imports no feature module except `config` and `audit` | Rules are data; enforcers plug in through the registry, so the engine never grows per family |
| An adapter sub-folder imports only `adapters/contract` and modules allowed to `adapters` | One harness's churn cannot break another (PRD §11.4) |

## 3.4 Public interfaces

Signatures are normative; names are TypeScript. `Result<T>` is `{ ok: true; value: T } | { ok: false; error: CdxError }` (§4.1).

| Interface | Owner | Shape |
|---|---|---|
| `Enforcer` | §4.3 | `{ id; kinds: Trigger[]; budgetMs; check(ctx: CheckContext, params: Params): Promise<Finding[]> }` |
| `Pack` | §4.4 | `{ manifest: PackManifest; enforcers: Enforcer[]; drivers: Driver[]; assets: AssetTemplate[] }` |
| `Adapter` | §4.5 | `{ id; capabilities: Capabilities; render(input: RenderInput): FileArtifact[]; parse(event: string, raw: unknown): Result<HookEvent>; reply(decision: HookDecision): HookReply }` |
| `Driver` (ecosystem) | §4.8 | `{ ecosystem; detect(repo): boolean; readManifests(repo): Manifest[]; registry: RegistryClient; edit(upgrade): FileEdit[] }` |
| `ImportExtractor` | §4.11 | `{ language; extensions: string[]; extract(path, text): ImportRef[] }` |
| `Engine.evaluate` | §4.3 | `(trigger: Trigger, scope: Scope, now: Instant) => Promise<Verdict>` |
| `LlmClient.complete` | §4.17 | `(req: CompletionRequest) => Promise<Result<CompletionResponse>>` |

## 3.5 Compiler contract

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`, `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, `module`/`moduleResolution` `nodenext`, `target` `es2024`. Source imports use `.ts` extensions so tests run on source without a build. No `enum`, namespaces, parameter properties or decorators (erasable syntax only). `JSON.parse` is called only inside the kernel's `parseJson`, which returns `Result<unknown>`.

## 3.6 Extension points

Every point is data or repo-owned code, loaded through the same validation; none can weaken a floor rule or widen a bound (PRD §6 P2).

| Point | Where declared | Owner |
|---|---|---|
| Custom pack (rules, fixtures, enforcers) | `.codictator/packs/<id>/` | §4.4 |
| External tool as enforcer or helper | `config.tools` + pack enforcer of kind `external` | §4.4.5 |
| Custom adapter | `.codictator/adapters/<id>/adapter.mjs` | §4.5.6 |
| LLM provider | `config.llm` | §4.17 |
| Workflow phases | `config.workflow` | §4.12 |
| Architecture module map | `config.architecture` | §4.11 |

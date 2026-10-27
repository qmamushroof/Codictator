# 6. Language Packs

**[◀ 5. Core Rules](05-CORE-RULES.md)** · [SPEC index](../SPEC.md) · **[7. Files and Formats ▶](07-FILES-AND-FORMATS.md)**

Each pack supplies the language knowledge that core rules need (drivers, extractors, measures, patterns, commands) plus its own rules (PRD §7.2, §12 #4). Order of delivery: TypeScript/JavaScript (P0), .NET, Python (P1, PRD §9.1). A pack never runs a tool the repo has not pinned; it uses the repo's own compiler, linter and test runner.

## 6.1 TypeScript / JavaScript (`typescript`)

| Supplies | Specification |
|---|---|
| Driver `npm` | Manifests `package.json` (`dependencies`, `devDependencies`, `optionalDependencies`, `overrides`; `peerDependencies` and `engines` are compatibility, §4.8 EC-6). Exact pin = full `x.y.z[-pre]`; allowed non-registry forms: `workspace:` siblings, `file:`/`link:` inside the repo, `npm:` aliases with exact versions. Lockfile `package-lock.json` (v3); `pnpm-lock.yaml` and `yarn.lock` checked with their own frozen-lockfile commands. Owned `.npmrc` entry `save-exact=true`. Toolchain: `.nvmrc` exact, `packageManager` exact |
| Commands (detected, overridable in `config.commands`) | build `npm run build` if defined · typecheck: the repo's `tsc --noEmit -p <tsconfig>` · test: `npm test` · coverage: runner's own (`node --test --experimental-test-coverage`, `vitest --coverage`, `jest --coverage`) · smoke: `npm run smoke` if defined |
| Strict settings (`core/compiler-strict`) | Every `tsconfig*.json` used by a build or test: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`; JavaScript projects: `allowJs` + `checkJs` with the same flags |
| File naming (`core/file-naming`) | `kebab-case` for `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`; tests `*.test.<ext>`; framework-reserved names (`[id].tsx`, `+page.svelte`, `_app.tsx`) allowed |
| Import extractor | ES `import`/`export … from`, `import()`, `require()`, `import x = require()`; resolution via nearest tsconfig `paths`/`baseUrl`, `package.json` `exports`/`imports`, workspaces |
| Test titles and filters | `test`/`it`/`describe` string-literal titles joined outer to inner; filter: `--test-name-pattern` (node:test), `-t` (Vitest, Jest); report: JUnit (`--test-reporter=junit`, Vitest `--reporter=junit`) or Jest `--json` |
| Assertion tokens | `assert.`, `assert(`, `expect(`, `.should`, `t.assert` |
| Skip markers | `.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `fit(`, `fdescribe(`, `{ skip: true }`, `{ only: true }` |
| Suppressions | `eslint-disable`, `biome-ignore`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `istanbul ignore`, `c8 ignore`, `v8 ignore` |
| Measures | Function size by brace matching from `function`, method and arrow-body starts; cyclomatic = 1 + count of `if`, `for`, `while`, `case`, `catch`, `&&`, `\|\|`, `??`, `? :`; dead code = exported name in a non-entry file with no importer; speculative abstraction = `interface`/`abstract class` with exactly one `implements`/`extends`; guard lines contain `throw `, `assert`, or a schema `.parse(` |
| I/O for the classifier | `node:fs`, `node:child_process`, `node:net`, `node:http(s)`, `fetch(`, `pg`, `mysql2`, `mongodb`, `ioredis`, `redis`, `@prisma/client`, `drizzle-orm`, HTTP-client packages |
| Hot-path patterns | `app.<verb>(` and `router.<verb>(` for HTTP verbs and `all`, `fastify.route(`, Nest `@Get(`/`@Post(`/`@Put(`/`@Patch(`/`@Delete(`, exported `GET`/`POST` route handlers, `new Worker(` (BullMQ), `consumer.run(` (KafkaJS) |

| Capability (one per repo) | Packages | Platform provides (pinned Node ≥ 24) |
|---|---|---|
| HTTP client | `axios`, `got`, `node-fetch`, `ky`, `superagent`, `undici`, `request`, `cross-fetch` | `fetch` |
| Unique ids | `uuid`, `nanoid` | `crypto.randomUUID` |
| Env files | `dotenv` | `node --env-file` |
| Test runner | `jest`, `vitest`, `mocha`, `ava`, `jasmine`, `tap` | `node:test` |
| Glob | `glob`, `fast-glob`, `globby` | `fs.glob` |
| Recursive fs | `rimraf`, `mkdirp`, `fs-extra` | `fs.rm`, `fs.mkdir({ recursive })`, `fs.cp` |
| Deep clone | `lodash.clonedeep`, `clone-deep`, `rfdc` | `structuredClone` |
| Terminal colours | `chalk`, `kleur`, `picocolors`, `colors` | `util.styleText` |
| Argument parsing | `commander`, `yargs`, `minimist`, `meow` | `util.parseArgs` |
| Dates | `moment`, `dayjs`, `date-fns`, `luxon` | — |
| Schema validation | `zod`, `yup`, `joi`, `ajv`, `valibot`, `superstruct` | — |
| Lint | `eslint`, `@biomejs/biome`, `oxlint` | — |
| Format | `prettier`, `@biomejs/biome`, `dprint` | — |
| Utility belt | `lodash`, `underscore`, `ramda`, `remeda` | — |

| Pack rule | Tier | Check | Layers |
|---|---|---|---|
| `ts/typecheck` | floor | The repo's `tsc --noEmit` passes (project-wide at L4; projects containing staged files at L3) | L3, L4 |
| `ts/lint` | floor | The repo's linter passes on scope; when none exists, `init` proposes Biome at its latest stable version | L2, L3, L4 |
| `ts/no-phantom-import` | floor | A bare import resolves to a dependency declared in the nearest `package.json` or a Node built-in (anti-hallucination, PRD §8.3) | L1, L3, L4 |
| `ts/security-patterns` | floor | `eval(`, `new Function(`, `child_process` `exec`/`execSync` with a template or concatenated argument, `innerHTML`/`outerHTML` assignment, `document.write(`, `dangerouslySetInnerHTML`, `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED`, template or concatenated SQL passed to `.query(`, `.execute(`, `.raw(` | L1, L3, L4 |

## 6.2 .NET (`dotnet`)

| Supplies | Specification |
|---|---|
| Driver `nuget` | Central Package Management required: `Directory.Packages.props` with `<PackageVersion Include Version="x.y.z" />` exact (no ranges, no `*`); `RestorePackagesWithLockFile=true` and `packages.lock.json` per project; CI restores with `--locked-mode`. Toolchain: `global.json` `sdk.version` exact with `rollForward: "disable"`; source: .NET `releases-index.json` |
| Commands | build `dotnet build -warnaserror` · test `dotnet test` · format `dotnet format --verify-no-changes` · coverage via the repo's collector (`coverlet` or `dotnet-coverage`) |
| Strict settings (`core/compiler-strict`) | `Directory.Build.props`: `Nullable=enable`, `TreatWarningsAsErrors=true`, `AnalysisLevel=latest`, `EnforceCodeStyleInBuild=true`; owned `.editorconfig` entries raise security analyzers to `error`: CA2100, CA2300–CA2330, CA3001–CA3012, CA5350, CA5351, CA5359 |
| File naming | `PascalCase.cs` matching the single top-level type it declares; test projects `*.Tests` |
| Import extractor | `ProjectReference` edges between projects; `using` namespaces mapped to projects by `RootNamespace` for intra-project modules |
| Tests | xUnit, NUnit, MSTest; titles from `DisplayName` or method name, spec refs via `[Trait("spec", "§x")]`; filter `--filter`; reports TRX (built in) or JUnit — the kernel reads both |
| Patterns | Assertions `Assert.`, `.Should()`, `Verify(`; skips `Skip =`, `[Ignore`, `[Explicit`; suppressions `#pragma warning disable`, `[SuppressMessage`, `// ReSharper disable`, `<NoWarn>` growth |
| Capabilities | JSON `Newtonsoft.Json` vs platform `System.Text.Json`; HTTP `RestSharp`, `Flurl.Http` vs `HttpClient`; mapping `AutoMapper`, `Mapster`; mocking `Moq`, `NSubstitute`, `FakeItEasy`; test framework `xunit*`, `NUnit`, `MSTest*`; assertions `FluentAssertions`, `Shouldly`; logging `Serilog`, `NLog`, `log4net` |
| I/O and hot paths for the classifier | I/O: `System.IO`, `System.Net`, `System.Diagnostics.Process`, `HttpClient`, `Microsoft.EntityFrameworkCore`, `Dapper`, `Npgsql`, `Microsoft.Data.SqlClient`, `StackExchange.Redis`. Hot paths: `[HttpGet]`/`[HttpPost]`/`[HttpPut]`/`[HttpPatch]`/`[HttpDelete]`, `app.Map<Verb>(`, `IHostedService`/`BackgroundService` subclasses |

Pack rules: `dotnet/build` (floor; build with warnings as errors), `dotnet/format` (floor), `dotnet/no-phantom-reference` (floor; `using` of a namespace from no referenced assembly is caught by the build, so this rule checks `PackageReference` without `PackageVersion`).

## 6.3 Python (`python`)

| Supplies | Specification |
|---|---|
| Driver `pypi` | `pyproject.toml` `[project] dependencies` and dependency groups as `name==x.y.z`; lock `uv.lock` or fully pinned `requirements*.txt` (every line `==`, with `--hash`); toolchain `.python-version` exact; source: python.org release listing |
| Commands | typecheck `mypy` or `pyright` · lint `ruff check` · format `ruff format --check` · test `pytest` · coverage `pytest --cov --cov-report=json` |
| Strict settings (`core/compiler-strict`) | mypy `strict = true` or pyright `typeCheckingMode = "strict"`; ruff `select` includes `E`, `F`, `B`, `S`, `UP`, `I` |
| File naming | `snake_case.py`; tests `test_*.py` |
| Import extractor | `import a.b`, `from a import b`, relative levels; `src/` layout and namespace packages |
| Tests | pytest node ids; spec refs via `@pytest.mark.spec("§x")` or the test docstring; filter by node id; report `--junitxml` |
| Patterns | Assertions `assert `, `self.assert`, `pytest.raises`; skips `@pytest.mark.skip`, `skipif`, `xfail`, `unittest.skip`; suppressions `# noqa`, `# type: ignore`, `# pyright: ignore`, `# pragma: no cover`, `# nosec`; measures by indentation blocks; cyclomatic adds `elif`, `except`, `and`, `or`, comprehension `if` |
| Capabilities | HTTP `requests`, `httpx`, `aiohttp`, `urllib3`; dates `arrow`, `pendulum`, `python-dateutil`; tests `pytest`, `nose2`; lint/format `ruff` vs `flake8`, `pylint`, `black`, `isort` |
| I/O and hot paths for the classifier | I/O: `open(`, `os`, `subprocess`, `socket`, `pathlib`, `requests`, `httpx`, `aiohttp`, `sqlalchemy`, `psycopg`, `pymongo`, `redis`. Hot paths: `@app.<verb>(` and `@router.<verb>(` (FastAPI, Flask), Django `path(` in `urls.py`, `@shared_task`/`@app.task` (Celery) |

Pack rules: `python/typecheck` (floor), `python/lint` (floor), `python/no-phantom-import` (floor; top-level import resolves to a declared dependency, the standard library, or a first-party package), `python/security-patterns` (floor: `eval(`, `exec(`, `subprocess` with `shell=True`, `pickle.loads`, `yaml.load` without `SafeLoader`, `verify=False`).

## 6.4 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Repo uses Biome and Prettier together | Block `core/dep-one-per-capability` (format) |
| EC-2 | `tsconfig.json` extends a base with `strict` | Effective settings resolved through `extends` |
| EC-3 | Test title built from a variable | Title unknown; spec trace fails for that test with "use a literal title" |
| EC-4 | `import x from "node:fs"` | Built-in, never phantom |
| EC-5 | Workspace package imports a sibling declared as `workspace:*` | Allowed |
| EC-6 | `.csproj` with inline `Version` on `PackageReference` | Block: central management required |
| EC-7 | `requirements.txt` line `requests>=2` | Block `core/dep-exact-pin` |
| EC-8 | Python namespace package without `__init__.py` | Resolved by directory |
| EC-9 | JS repo without TypeScript | `checkJs` required; TypeScript proposed as a dev dependency |
| EC-10 | Mixed TS + Python repo | Both packs load; each file judged by its pack |

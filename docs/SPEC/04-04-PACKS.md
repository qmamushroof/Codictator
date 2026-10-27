# 4.4 packs

**[◀ 4.3 engine](04-03-ENGINE.md)** · [SPEC index](../SPEC.md) · **[4.5 adapters ▶](04-05-ADAPTERS.md)**

Loads, composes and self-tests packs (PRD §7.2), and runs external tools as enforcers (§4.4.5). The rules themselves are catalogued in §5 and §6.

## 4.4.1 Pack layout

```
<pack>/
  pack.json                         manifest (§7.3): id, version, rules, enforcers, drivers, assets
  enforcers/*.ts | *.mjs            code enforcers (built-in: .ts; custom: .mjs)
  fixtures/<rule-slug>/
    violating/<case>/case.json      trigger, hook input or diff, expected rule ids
    violating/<case>/tree/...       files the case evaluates
    passing/<case>/...              same shape, expects zero findings for the rule
  assets/                           agent asset templates (skills, subagents, commands, §4.6.6)
  accepted.json                     custom packs only (§7.4)
```

## 4.4.2 Built-in packs

| Pack | Detected when | Contents |
|---|---|---|
| `core` | Always loaded | Every rule in §5 |
| `typescript` | `package.json` or `tsconfig*.json` at any depth outside ignored dirs | §6.1, npm driver |
| `dotnet` | `*.sln`, `*.slnx` or `*.csproj` | §6.2, NuGet driver |
| `python` | `pyproject.toml`, `setup.cfg`, `requirements*.txt` | §6.3, PyPI driver |

Built-in packs carry the engine's version; they cannot be pinned independently, so a repo's rule set is fully named by `config.codictator`.

## 4.4.3 Loading and composition

1. Load `core`, then language packs in `config.packs` order, then custom packs.
2. Rule ids are globally unique; a duplicate → `CDX-E202`.
3. A custom pack id must not equal a built-in pack id, and its rule ids must start with `<packId>/` → else `CDX-E204`.
4. A rule's `enforcer` must resolve to an enforcer in the same pack or a built-in parametric enforcer (§4.4.6) → else `CDX-E205`.
5. Language packs compose: a repo with TypeScript and Python loads both; drivers and extractors are selected by file extension.

## 4.4.4 Self-test (PRD §6 P3)

For every rule in a pack:

| Assertion | Failure |
|---|---|
| Has at least one violating case | `CDX-E211` |
| Every violating case yields ≥ 1 finding with this rule id | `CDX-E212` |
| Every passing case yields zero findings with this rule id | `CDX-E213` |
| `remediation` is non-empty and differs from `reason` | `CDX-E214` |
| Every fixture run finishes inside the enforcer's `budgetMs` × 2 | `CDX-E215` |
| Every tunable param has `default` within `bound` and a `stricter` direction | `CDX-E216` |

Built-in packs self-test in Codictator's CI (§10). Custom packs self-test on `codictator pack test`, before acceptance, and on every L4 run (`core/custom-pack-selftest`). L1–L3 load a custom pack only when its content hash equals `accepted.json.packHash`, so an unaccepted edit is inert locally and red in CI.

## 4.4.5 External tools

Any external program — linter, scanner, test runner, knowledge-graph builder, token saver — plugs in through one contract (founder decision, §11 S16).

**Declaration.** The tool is declared once in `config.tools` (schema §7.2). `role` is `enforcer` or a helper role (`knowledge-graph`, `token-saver`, `dependency-bot`, `other`); `version` holds the exact `pin` and the `probe` argv whose output must match `pattern`; `network` is declared and shown in `status`. `command` is an argv array using the placeholders below, and optional `ci.install` holds install argv per OS. A pack enforcer of `kind: "external"` binds it to rules:

| Field | Values |
|---|---|
| `tool` | A `config.tools` id |
| `input` | `file` (`{file}`), `files` (`{files}`), `staged`, `diff`, `repo` (`{root}`), `stdin-json` (scope as JSON on stdin) |
| `output.format` | `sarif` (2.1.0), `json` (with dotted-path `select` for results, path, line, rule, message), `regex` (named groups `path`, `line`, `rule`, `message`), `exit-code` |
| `output.source` | `stdout` or `{out}` (a temp file Codictator creates and deletes) |
| `exitCodes` | `pass` and `findings` code lists; any other code is a tool error |
| `ruleMap` | Tool rule id (or `*`) → a rule id **of the same pack** |

**Execution and safety.**

| Concern | Rule |
|---|---|
| Injection | `Proc.run` with argv, `shell: false`; each placeholder expands to separate argv entries, never string-concatenated; a path starting with `-` is passed as `./-…` |
| Long file lists | Batched so no command line exceeds 24 KB (Windows limit with margin); results merged |
| Version | `probe` runs once per tool per session or CI job (cached by resolved executable path and mtime); output must match `pin` exactly → else `CDX-E208`, block |
| Missing tool | `CDX-E209`; blocks at every layer the rule declares except L2, which advises |
| Tool error, unparseable output, timeout | `CDX-E207` / `CDX-E902`; block (fail closed) |
| Environment | Kernel allowlist plus `envPass` names; secrets never passed unless named |
| Output size | 16 MiB cap; beyond → `CDX-E207` |
| Visibility | Each run appends a `tool` event: id, version, argv digest, exit code, duration, finding count |

**Limits.** An external tool can only **add** findings. It cannot map to a built-in rule id (`CDX-E210`) or change a tier, default or bound. It cannot suppress or replace a built-in enforcer: an external secret scanner runs beside `core/no-secrets`, never instead of it. Its rules activate only after the pack self-test passes **with the real tool installed**, so an absent tool fails the self-test. Helpers (`role` ≠ `enforcer`) produce no verdicts; steering and agent-asset rules consume them (§4.6).

## 4.4.6 Parametric enforcers

Custom and generated rules may use these built-in enforcers instead of code:

| Enforcer | Checks |
|---|---|
| `pattern-forbid`, `pattern-require` | Regex over files matching globs |
| `path-placement` | Allowed locations by glob |
| `file-size`, `file-required` | Size limit; required file and content |
| `import-forbid` | Edges of the §4.11 graph |
| `command-forbid` | Commands, via the §4.7.2 shell analyser |
| `json-key` | Required or forbidden key/value |
| `external` | §4.4.5 |
 Generated packs may use only these (§4.16); hand-written custom packs may also ship `.mjs` code enforcers, which run in-process with the repo's own trust, like any repo script.

## 4.4.7 Acceptance of custom packs

`codictator pack accept <id>` (human-only, §4.2.3) runs the self-test, then writes `accepted.json` (§7.4): `packHash`, `selfTestHash`, `acceptedAt`, `acceptedBy` (git `user.email`). Any later byte change to the pack invalidates acceptance.

## 4.4.8 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Rule without violating fixture | Load fails `CDX-E211` |
| EC-2 | Violating fixture passes (enforcer too weak) | `CDX-E212`, pack inert |
| EC-3 | Passing fixture blocked (false positive) | `CDX-E213`, pack inert |
| EC-4 | Custom pack edited after acceptance | Inert at L1–L3 with an advise naming it; L4 blocks `core/custom-pack-selftest` |
| EC-5 | Custom rule id `core/x` | `CDX-E204` |
| EC-6 | External tool maps to `core/no-secrets` | `CDX-E210` |
| EC-7 | External tool prints a newer version than pinned | `CDX-E208`, block; remediation: pin the new version through config |
| EC-8 | External tool exits with an unlisted code | `CDX-E207`, block |
| EC-9 | External tool emits SARIF with a path outside the repo | Finding dropped and `CDX-E207` raised (tool output untrusted) |
| EC-10 | `{files}` expands to 20,000 paths | Batched; one merged result |
| EC-11 | File named `--exec=rm` passed to a tool | Passed as `./--exec=rm` |
| EC-12 | Tool hangs | Killed at `timeoutMs`; `CDX-E902` |
| EC-13 | Two language packs both claim `.js` | Extractor from the first pack in `config.packs`; the second's is unused and reported by `status` |
| EC-14 | Helper tool missing while `core/agent-assets-present` requires it | That rule blocks at L4; no other rule is affected |

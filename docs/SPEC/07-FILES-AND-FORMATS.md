# 7. Files and Formats

**[◀ 6. Language Packs](06-LANGUAGE-PACKS.md)** · [SPEC index](../SPEC.md) · **[8. Errors and Exit Codes ▶](08-ERRORS-EXIT-CODES.md)**

Owner of every file and wire format. Each JSON format ships a JSON Schema (2020-12 subset, §4.1.2) at `packages/codictator/schema/<name>.schema.json`, carries `"version": 1`, rejects unknown keys, and is written with `stableStringify`. A version bump is a breaking change handled by `codictator regen` migrations.

## 7.1 Target repo layout

| Path | Committed | Written by | Format |
|---|---|---|---|
| `.codictator/config.json` | yes | human (`init`, hand edit) | §7.2 |
| `.codictator/waivers.json` | yes | `waive` | §7.5 |
| `.codictator/baseline.json` | yes | `init`, L3 tighten, `baseline capture` | §7.6 |
| `.codictator/manifest.json` | yes | `init`, `regen` | §7.14 |
| `.codictator/tasks/T-####.json` | yes | `task`, `test`, `review` commands | §7.11 |
| `.codictator/plan/remediation.json` | yes | `remediate plan` | §7.13 |
| `.codictator/packs/<id>/` | yes | human or `generate` | §7.3, §7.4 |
| `.codictator/adapters/<id>/` | yes | human | §4.5.6 |
| `.codictator/bin/run.mjs` | yes | `init`, `regen` | §4.19.3 |
| `.codictator/tool/` (`package.json`, lockfile) | yes, `node_modules` ignored | `init` (non-npm repos) | §4.19.4 |
| `.codictator/state/` (events, sessions, markers, captures, `resume.md`) | no | runtime | §7.10 |
| `.codictator/cache/` (effective config, graph, registry) | no | runtime | §7.12 |
| `.githooks/*` or managed blocks in `.husky/*` | yes | `install-hooks` | §4.14.4 |
| `docs/HISTORY/<YYYY-MM-DD>[-n].md`, `docs/BUGS/<YYYY>[-n].md` | yes | agents via workflow; CI for bot PRs | §7.7 |
| Harness files (§4.5.4), `AGENTS.md` block, CI workflow, bot config keys | yes | `init`, `regen` | §4.5, §4.6.2, §4.15, §4.8.6 |

`init` adds `.codictator/state/`, `.codictator/cache/`, `.codictator/tool/node_modules/` to `.gitignore` (manifest-owned entries).

## 7.2 `config.json`

| Key | Type | Notes |
|---|---|---|
| `version` | `1` | |
| `codictator` | exact version | Must equal the installed engine (§4.2.1) |
| `packs` | `[{ id, version? , path? }]` | Built-ins take the engine version; custom packs give `path` |
| `harnesses` | adapter ids | `muse-code`, `universal`, `claude-code`, `copilot`, `codex-cli`, `cursor`, `gemini-cli`, `opencode`, `custom:<id>` |
| `tunables` | `{ <ruleId>: { <param>: value } }` | Tightening only (§4.2.2) |
| `architecture` | `{ profile, modules: [{ name, path, kind, entry, dependsOn }], layers: { enabled, names }, deny: [{ from, to }] }` | §4.11 |
| `workflow` | `{ phases: [{ name, after, gate: { kind, args } }] }` | Custom phases only (§4.12.2) |
| `spec` | `{ paths, refPattern }` | §4.10.1 |
| `testing` | `{ kindGlobs: { unit, acceptance, integration, architecture, stress, load }, hotPaths }` | §4.10.3 |
| `commands` | `{ build, typecheck, lint, test, coverage, perf, smoke }` each an argv array | Overrides pack detection |
| `steering` | `{ contextWindow, scopedContextFiles, mcpAllowed, requiredHelpers }` | §4.6 |
| `tools` | `[{ id, command, version: { pin, probe, pattern }, role, timeoutMs, envPass, network, ci: { install } }]` | §4.4.5 |
| `security` | `{ fixtureGlobs, protectedBranches }` | §4.7 |
| `deps` | `{ bot: "auto" \| "renovate" \| "dependabot" \| "none" }` | §4.8.6 |
| `network` | `{ registries: [host] }` | Extra private registry hosts (§9.2) |
| `integrity` | `{ trailerExempt: [author] }` | §4.14.2 |
| `ci` | `{ host: "github" \| "external", os: [runner] }` | §4.15 |
| `llm` | `{ provider, baseUrl, format, model, apiKeyEnv, timeoutMs, maxOutputTokens, reasoningEffort }` | §4.17 |

## 7.3 `pack.json` (rule definition schema)

| Key | Notes |
|---|---|
| `id`, `version`, `description` | Built-ins: `core`, `typescript`, `dotnet`, `python` |
| `rules[]` | `{ id, family, tier, statement, reason, remediation, enforcer, triggers[], scope[], params, ratchet, measureVersion, fixtures: { violating[], passing[] } }` |
| `rules[].params` | `{ <name>: { type: "integer" \| "number" \| "string[]", default, bound, stricter: "lower" \| "higher" \| "subset" \| "superset" \| "policy", min?, max? } }` |
| `rules[].remediation` | Template with `{path}`, `{line}`, `{value}`, `{limit}`, `{detail}` placeholders |
| `enforcers[]` | `{ id, kind: "code" \| "pattern-forbid" \| … \| "external", module?, budgetMs, args }` (§4.4.6, §4.4.5) |
| `drivers[]`, `extractors[]`, `measures[]` | Language packs only (§6) |
| `capabilities[]` | `{ name, packages[], platform? }` (§4.8.5) |
| `assets[]` | `{ id, kind: "skill" \| "subagent" \| "command", template }` (§4.6.6) |
| `maxWaiverDays` | Integer; core: 90 |

## 7.4–7.6 Pack acceptance, waivers and baseline

### 7.4 `accepted.json` (custom packs)

`{ version: 1, packHash, selfTestHash, acceptedAt, acceptedBy }` — `packHash` covers every file in the pack except this one, sorted by path.

### 7.5 `waivers.json`

`{ version: 1, waivers: [{ id: "W-####", rule, params, paths?, reason, created, expires, createdBy, renews? }] }`. Dates are ISO `YYYY-MM-DD`, compared at 00:00 UTC.

### 7.6 `baseline.json`

`{ version: 1, entries: { "<ruleId>@<measureVersion>": { "<metricKey>": count } } }`. Keys sorted; zero counts removed.

## 7.7 Record grammars

**History file** `docs/HISTORY/<YYYY-MM-DD>[-n].md`: the line `# History — <YYYY-MM-DD>`, then one entry per commit, newest entry directly under the title, then in reverse-chronological commit order, each preceded by a blank line. An entry is a heading and a field list in this order:

```
## <YYYY-MM-DD> · <commit subject>
- **Kind:** <code | docs | deps | guardrail>
- **Task:** <T-#### | none>
- **Bug:** <BUG-####>
- **Why:** <text>
- **What went wrong:** <text | none>
- **Trade-offs:** <text>
- **Lessons:** <text>
- **Docs:** <path, path, … | none>
- **Deps:** <+ name@x.y.z — reason — rung | ↑ name a → b — advisory ids or none | − name — reason>
```

The date is the commit date in UTC. Which fields a kind requires is §4.9.3; a field not required is omitted, and every value is one line. Each dependency change gets its own `Deps` line in one of the three forms (added, upgraded, removed).

**Bug file** `docs/BUGS/<YYYY>[-n].md`: the line `# Bugs — <YYYY>`, a blank line, then exactly this header and one row per defect in id order.

```
| Id | Status | Title | Found | Fix | Regression test |
|---|---|---|---|---|---|
```

| Column | Value |
|---|---|
| Id | `BUG-####`, one sequence across all years |
| Status | Exactly one of `open`, `fixed`, `wontfix` |
| Title | One line; a literal pipe is written `\|` |
| Found | `<YYYY-MM-DD>, <T-#### or none>` |
| Fix | Empty while `open`; for `fixed`, `<T-#### or none>, <fixing commit subject>`; for `wontfix`, the reason (at least 20 characters) |
| Regression test | Empty unless `fixed`; then the repo path of the test file |

## 7.8 Hook I/O contract (normalised)

`HookEvent`:

| Field | Notes |
|---|---|
| `harness`, `event` (native name), `trigger` (§4.3.2) | |
| `sessionId`, `agentId?`, `role?`, `cwd`, `source?` (`startup` \| `resume` \| `clear` \| `compact`) | |
| `tool?` | `{ kind, name, paths[], command?, proposedContent?, edits?: [{ old, new }], range?: { offset, limit }, query? }` |
| `prompt?` | Digest and length only beyond the evaluation |
| `usage?` | `{ contextTokens, contextWindow }` when the adapter has it |
| `transcriptPath?`, `modelProvider?` | |

`HookDecision`: `{ decision: "allow" | "advise" | "block" | "escalate", message?, additionalContext?, eventId }`. Each adapter's `reply` maps it to its harness (§4.5.4).

## 7.9 Capability declaration

`{ harness, adapterVersion, verifiedAgainst: { version, date, source }, layers: { L0..L5: "native" | "partial" | "none" }, controls: { contextFile, contextInject, postCompactInject, promptBlock, preToolBlock, readBlock, postToolFeedback, autoCompactConfig: "native" | "partial" | "none", forceCompact, forceClear, usageData: "native" | "transcript" | "none", skills, subagents, commands, projectPermissions, trustRequired, timeoutFailMode: "closed" | "open" | "unknown", launcherMissingFailMode: "closed" | "open" | "unknown", hookIoVerified, projectRootSource, agentEnvMarkers: [name] }, gaps: [text] }`. Boolean controls are `true` only when documented or captured; unverified means `false`.

## 7.10 Event log line

`{ v: 1, id, ts, now, kind, layer, trigger, harness?, sessionId?, taskId?, ruleIds[], decision?, findings?: [{ ruleId, path?, line?, code? }], waivers?[], durationMs, configHash, packs: { id: version }, snapshotHash?, inputDigest, message? }`. `id` is a ULID-style sortable id from `now` plus a per-process counter. `kind` values (append-only): `verdict`, `injection`, `escalation`, `waiver`, `upgrade`, `integrity`, `tool`, `install`, `remediation`, `review`, `session`, `llm`.

## 7.11 Task record

`{ version: 1, id, type, title, branch, phase, phases: [{ name, enteredAt, evidence }], spec[], acceptanceCriteria[], files: { allow[] }, tests: [{ path, title, kind }], diagnosis?, redProof?: { commit, tree, failing[], at }, greenProof?, authorSessions[], roles: { <sessionId>: role }, reviews: [{ round, tree, reviewer: { sessionId, harness, identity: "observed" | "declared" }, findings[], acknowledgedExceptions[], at }], integrityExceptions[], checkpoints: [{ at, sessionId, done, next, openQuestions }], escalations: [{ at, ruleId, attempts, ackedBy?, note? }], deps?: { added: [{ name, reason, rung }] } }`.

## 7.12 Registry snapshot

`{ version: 1, ecosystem, fetchedAt, packages: { <name>: { versions: { <v>: { published, deprecated?, yanked?, license?, engines? } } } }, advisories: { <name@v>: [osvId] } }`. Only fields used by §4.8.3 are stored.

## 7.13 Remediation plan

`{ version: 1, generatedFrom: { head, baselineHash }, steps: [{ id, kind, target: [{ ruleId, key, from }], scope[], executor, dependsOn[], sizeBudget: { files, lines }, expectedDelta, status, attempts, children[], taskId?, branch?, lastFailure? }] }`.

## 7.14 Guardrail manifest

`{ version: 1, codictator, artifacts: [{ path, owner, mode: "file" | "block" | "entries", hash }], hash }` — `hash` is over the sorted `artifacts` array, so editing the manifest itself is detectable.

## 7.15 Stdio protocol (extension)

JSON-RPC 2.0, one message per line, UTF-8. `initialize → { protocolVersion: 1, engineVersion, root }`.

| Method | Result |
|---|---|
| `status` | §4.18.3 JSON |
| `rules/list` | Rules with effective params, waivers, coverage |
| `findings/list { files? }` | Findings with remediation |
| `verify { layer, files? }` | Verdict |
| `events/tail { since?, limit }` | Events |
| `steering/history { sessionId? }` | Injections |
| `budget/current` | Bands per session or `unavailable` |
| `explain { id }` | §4.18.2 |
| `run { argv }` | CLI result; human-only → error `CDX-E107` with `data.commandLine` |
| notification `events/appended` | New event lines |

## 7.16 Review findings file

`{ version: 1, findings: [{ id, severity, path, line?, message }] }` — passed to `review submit`; ids unique within the round.

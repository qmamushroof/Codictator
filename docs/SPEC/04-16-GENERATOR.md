# 4.16 generator

**[◀ 4.15 ci](04-15-CI.md)** · [SPEC index](../SPEC.md) · **[4.17 llm ▶](04-17-LLM.md)**

Turns requirements, examples, existing tool configs and templates into a custom pack (PRD §7.9, §12 #20). The output is always deterministic artifacts — rules over parametric enforcers (§4.4.6) plus fixtures — inert until self-test and human acceptance (§4.4.7). The LLM is optional and never runs at enforcement time (PRD §6 P1; §3.3 boundary).

## 4.16.1 Inputs

| Input | Flag | Use |
|---|---|---|
| Requirements | `--requirements <file.md>…` | Statements to turn into rules |
| Examples | `--good <dir>`, `--bad <dir>` | Become passing and violating fixtures |
| Existing tool configs | `--from-tool <path>` | Proposes `config.tools` entries and `external` enforcers (§4.4.5) for linters/scanners already in the repo |
| Template | `--template <id> --param k=v…` | Direct, LLM-free rule creation |

## 4.16.2 Templates

| Template | Enforcer | Parameters |
|---|---|---|
| `forbid-pattern` / `require-pattern` | `pattern-forbid` / `pattern-require` | regex, globs, message |
| `forbid-import` | `import-forbid` | from-module glob, to-module or package |
| `placement` | `path-placement` | file glob, allowed directory globs |
| `max-size` | `file-size` | globs, max lines or bytes |
| `forbid-command` | `command-forbid` | command pattern |
| `require-file` | `file-required` | path, content pattern |
| `config-key` | `json-key` | file, key path, required value |
| `external` | `external` | tool id, output mapping |

## 4.16.3 Flow

1. **Draft.** Template path: build the rule directly. LLM path: send the request (§4.16.4); the response must be a JSON draft matching `schema/pack-draft.schema.json` — rules expressed only as template ids and parameters, plus statement, reason, remediation, tier and fixture file contents.
2. **Validate.** Schema-check the draft; one repair round sends the validation errors back; still invalid → `CDX-E853`.
3. **Materialise** `.codictator/packs/<id>/` deterministically (sorted, `stableStringify`), with `--good`/`--bad` examples copied into fixtures alongside drafted ones.
4. **Self-test** (§4.4.4) and print the report: per rule, which fixtures caught or passed.
5. **Human acceptance** with `codictator pack accept <id>`; until then the pack is inert everywhere.

Generated rules default to `tunable` with bounds equal to the drafted value; a draft may mark a rule `floor` only when the user passes `--floor <ruleId>`, so strictness is a human choice.

## 4.16.4 What leaves the machine

Only with `--llm` and a configured provider (§4.17): the fixed system prompt (versioned with the engine), the template catalogue, the draft schema, the requirement text and the example files — capped at 64 KB, in argument order, truncated with a marker. Files matching secret patterns or secret paths (§4.7.1) are excluded and listed; detected secret values in included text are redacted. Nothing else from the repo is read for the prompt.

## 4.16.5 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | No LLM configured and `--llm` given | `CDX-E851` with provider setup steps |
| EC-2 | No LLM and template path | Works fully offline |
| EC-3 | LLM returns prose instead of JSON | Repair round, then `CDX-E853` |
| EC-4 | Draft references an unknown template | Validation error, repair round |
| EC-5 | Drafted regex is catastrophic (nested quantifiers) | Rejected by the pattern safety check (§9.2) |
| EC-6 | Drafted violating fixture does not violate | Self-test fails; pack stays inert; report says which |
| EC-7 | `--good` dir contains `.env` | Excluded from prompt and fixtures; listed |
| EC-8 | Pack id collides with an existing pack | `CDX-E204` |
| EC-9 | Draft tries to set a built-in rule's parameters | Rejected: generated packs own only their own ids |
| EC-10 | Input total exceeds 64 KB | Truncated with a visible marker; report lists cut files |

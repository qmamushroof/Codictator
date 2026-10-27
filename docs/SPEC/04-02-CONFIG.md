# 4.2 config

**[◀ 4.1 kernel](04-01-KERNEL.md)** · [SPEC index](../SPEC.md) · **[4.3 engine ▶](04-03-ENGINE.md)**

Loads `.codictator/config.json` (schema §7.2), validates it against the loaded packs and produces the effective rule set the engine evaluates. Implements PRD §6 P2 and §6.1 mechanically.

## 4.2.1 Resolution

1. Read and schema-validate `config.json`; any error → `CDX-E101`, every surface blocks (fail closed, PRD §12 #12).
2. Check `config.codictator` equals the installed engine version → else `CDX-E102`.
3. Load each pack listed in `config.packs` at its pinned version (§4.4); a missing or self-test-failing pack → `CDX-E203`.
4. Compute each rule's effective parameters: pack default → `config.tunables` (tightening only) → active waivers (loosening within bound, §4.3.4).
5. Freeze the result as `EffectiveConfig` and hash it (`configHash`, recorded in every event, §7.10).

There is no environment-variable or CLI-flag override of any rule parameter, so no surface can evaluate a different rule set.

## 4.2.2 Validation rules

| Check | Error |
|---|---|
| A floor rule id appears under `tunables` or in a waiver | `CDX-E103` — "floor rules have no override" |
| A tunable value is looser than the pack default | `CDX-E104` — remediation names the waiver path and the bound |
| A tunable value is outside the parameter type (e.g. negative size) | `CDX-E101` |
| `workflow` removes or reorders a mandatory gate (§4.12.2) | `CDX-E105` |
| `architecture.profile` unknown | `CDX-E101` |
| `harnesses` lists an adapter not installed | `CDX-E301` |
| `tools[]` entry without an exact `version.pin` | `CDX-E206` |
| `llm.apiKey` present as a literal (any key named like `key`, `token`, `secret` with a value) | `CDX-E106` — keys are referenced by env-var name only (§4.17) |
| Unknown top-level key | `CDX-E101` (`additionalProperties: false`) |

"Looser" is decided by the parameter's `stricter` direction (§7.3): `lower`, `higher`, or an ordered `levels` list. A `policy` parameter (e.g. the license allowlist) has no direction: it is the user's choice, edited only through the human path below and recorded (PRD §3 — Codictator gives no legal opinion).

## 4.2.3 The human-only change path

`config.json`, `waivers.json`, custom pack acceptance and baseline raises change only through human-only commands (§4.19.2). A human-only command requires an interactive TTY on stdin and stdout and refuses to run when any agent marker is present (`CODICTATOR_HOOK=1`, set by the launcher, plus every configured adapter's `agentEnvMarkers`, §7.9), returning `CDX-E107`. Agents are additionally blocked from running these commands by the shell guard (§4.14.3). A hand edit of `config.json` is allowed for humans; it is validated identically and its change appears in the CI summary (§4.18.4).

## 4.2.4 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | `config.json` missing in a repo with a manifest | `CDX-E101`; every layer blocks; remediation `codictator init --repair` |
| EC-2 | `config.json` missing and no manifest | Not a Codictator repo: hooks exit allow silently, `verify` exits `CDX-E108` |
| EC-3 | Tunable set exactly to the pack default | Accepted |
| EC-4 | Tunable set stricter than the strictest sensible value (e.g. max file lines 1) | Accepted; tightening is free (PRD §6.1) |
| EC-5 | Tunable looser than default but inside bound, in `tunables` | `CDX-E104`; must be a waiver |
| EC-6 | Floor rule id under `tunables` | `CDX-E103` and an `integrity` event |
| EC-7 | Duplicate pack id at two versions | `CDX-E101` |
| EC-8 | Config edited in the same commit that raises a baseline | Both changes reported; the baseline raise still fails (§4.3.5) |
| EC-9 | Config uses a rule id from a pack not loaded | `CDX-E101` naming the pack |
| EC-10 | Human-only command run from a git hook or CI | `CDX-E107` |
| EC-11 | Engine upgraded but `config.codictator` not bumped | `CDX-E102` with the one-line fix |

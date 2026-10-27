# 4.3 engine

**[◀ 4.2 config](04-02-CONFIG.md)** · [SPEC index](../SPEC.md) · **[4.4 packs ▶](04-04-PACKS.md)**

One deterministic evaluator behind every surface (PRD §7.1). It knows rules, enforcers, waivers and baselines; it knows no rule family. Enforcers register through packs (§4.4).

## 4.3.1 Rule model

A rule is data in a pack manifest (schema §7.3): `id`, `family` (`F1`–`F16`, PRD §8), `tier` (`floor` | `tunable`), `statement`, `reason`, `remediation`, `enforcer`, `triggers`, `scope` globs, `params` (each with `default`, `bound`, `stricter`), `ratchet` (boolean), `fixtures`. The pack loader rejects a rule missing `remediation`, `enforcer` or a violating fixture (PRD §6 P3, P4).

## 4.3.2 Triggers and layers

| Trigger | Layer | Scope passed to enforcers |
|---|---|---|
| `session.start`, `prompt.submit`, `compact.post`, `subagent.start` | L0 | session, task |
| `tool.pre.write`, `tool.pre.shell`, `tool.pre.read`, `tool.pre.search`, `tool.pre.other` | L1 | the one tool call (proposed content for writes) |
| `tool.post.write`, `stop` | L1 (feedback only, §4.5.2) | files written in the call or session |
| `editor.save` | L2 | the saved file |
| `git.pre-commit`, `git.commit-msg` | L3 | staged files, message |
| `git.pre-push` | L3 | `@{push}..HEAD` diff |
| `ci.verify` | L4 | `base..head` diff plus repo-wide rules |
| `schedule.sweep` | L5 | whole repo, fresh registry data |

A rule runs on a trigger only if the trigger is in its `triggers`; L4 runs every rule whose `triggers` include any L1–L4 trigger, so CI is a superset of every local layer (PRD §6 P6).

## 4.3.3 Evaluation

`evaluate(trigger, scope, now)`:

1. Select rules for `trigger` whose `scope` globs match at least one path in scope (path-free rules always match).
2. Run their enforcers concurrently (at most `os.availableParallelism()`), each under its `budgetMs` and the trigger time limit (§9.3).
3. Apply waivers (§4.3.4), then the ratchet (§4.3.5), to the findings.
4. Decide: any remaining finding from a rule configured to block at this trigger → `block`; findings only from advisory triggers (`session.*`, `prompt.submit` injections, L2) → `advise`; none → `allow`.
5. Build the agent message (§4.3.7).
6. Append the `verdict` event (§7.10) **before** returning; if the append fails, return `block` with `CDX-E801` (PRD §6 P5).

## 4.3.4 Waivers

A waiver (schema §7.5) applies to one tunable rule, sets parameter values between the pack default and the bound, optionally narrows to path globs, and carries `reason` (≥ 20 characters) and `expires`.

| Check | Result |
|---|---|
| Rule is floor | `CDX-E103` |
| Value beyond bound | `CDX-E109` with the bound and the compliant alternative |
| `expires` more than the pack's `maxWaiverDays` (core: 90) after `created` | `CDX-E110` |
| Renewal: a waiver with `renews` pointing at an earlier one | Allowed once; the chain may not exceed 2 × `maxWaiverDays` from the first `created` (§11 S11) |
| `now` past `expires` | The waiver is inert **and** `core/waivers-valid` blocks at L3/L4 until the entry is removed, so expiry is loud |

Active waivers appear in every verdict that they changed, in `status`, in the extension and in the CI summary (PRD §12 #16).

## 4.3.5 Ratchet

A rule with `ratchet: true` emits findings carrying a `metricKey` (usually the path). The engine counts findings per `(ruleId@measureVersion, metricKey)` and compares with `.codictator/baseline.json` (§7.6).

| Situation | Verdict |
|---|---|
| Count ≤ baseline for an untouched key | Pass (recorded debt) |
| Count > baseline, or key absent from baseline and count > 0 | Block — "worse than recorded" |
| A file touched by the change has baseline > 0 under at least one ratchet rule, and no rule's count for that file fell by at least `minDecrement` | Block by `core/ratchet-touched-improves` (PRD §12 #34: at least one ratcheted metric of a touched file falls; none rises, per the row above) |
| Count < baseline | Pass; L3 rewrites the baseline down and stages it; L4 blocks a head baseline that is higher than the measured counts ("stale baseline") |
| Head baseline higher than base baseline for any key | Block by `core/no-baseline-raise` (PRD §6 P9) |
| Pack bumps a rule's `measureVersion` | Old entries are ignored; the new measure enforces at zero until a human runs `codictator baseline capture --rule <id>`, which only captures, never raises an existing key |

Deleted files drop their keys. A pure rename (same normalised content) moves its keys and is not "touched".

## 4.3.6 Determinism

The verdict is a pure function of: repo content in scope, `configHash`, pack versions, registry snapshot hash (§4.8.4), the hook input, and `now`. All five are recorded in the event, so `codictator replay <eventId>` re-evaluates and must produce a byte-identical verdict (PRD §6 P1; §10.4). Enforcers receive the clock and data only from `CheckContext`; iteration over maps and file lists is sorted.

## 4.3.7 Verdict and message

`Verdict = { decision: "allow" | "advise" | "block"; findings: Finding[]; message: string; eventId; waiversApplied: string[] }`. The agent-facing message is plain text, at most 1,200 bytes for the first three findings plus a count line for the rest (PRD §6 P10):

```
Codictator blocked this: core/no-secrets (floor)
Why: a credential in the repo or context cannot be revoked from history.
Do instead: read it from an env var; add the name, without a value, to .env.example.
More: codictator explain core/no-secrets  (event 01JD…)
```

Every block carries `Do instead:` text from the rule's `remediation`, rendered with finding data (PRD §6 P4); the pack self-test asserts it is non-empty and differs from `Why`.

## 4.3.8 Fail closed

An enforcer that throws, exceeds its budget, or lacks required data yields a synthetic finding for its rule with `CDX-E901` (error), `CDX-E902` (timeout) or `CDX-E903` (data unavailable) and the verdict blocks (PRD §12 #12). L2 is the only exception: it advises, because it never gates.

## 4.3.9 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | No rule matches the trigger | `allow`, event still recorded |
| EC-2 | Enforcer throws | `block` with `CDX-E901`, message names the rule and says the guard failed, not the code |
| EC-3 | Enforcer exceeds budget | `block` with `CDX-E902` |
| EC-4 | Event log unwritable | `block` with `CDX-E801` |
| EC-5 | Waiver expires between two evaluations | First allows, second blocks; both events cite the waiver |
| EC-6 | Waiver targets a floor rule | Config load fails `CDX-E103` |
| EC-7 | Two waivers for the same rule and overlapping paths | The stricter applies; `core/waivers-valid` reports the overlap |
| EC-8 | Ratchet key count rises by 1 in an untouched file (e.g. a shared import made it worse) | Block |
| EC-9 | Touched file with baseline 0 | Normal rule applies; no decrement required |
| EC-10 | Touched file with baseline 5, count 5 under its only ratchet rule | Block by `core/ratchet-touched-improves` |
| EC-11 | File renamed and edited | Treated as touched under the new key; old key moved |
| EC-12 | Same input evaluated on Windows and Linux | Byte-identical verdict JSON |
| EC-13 | 50 findings | Message lists three, then "and 47 more — codictator verify" |
| EC-14 | Finding text contains a detected secret | Redacted in message and event by the kernel's `redactSecrets` (§4.1.2); the engine never imports `security` (§3.3) |
| EC-15 | `now` supplied earlier than the last event's `now` (clock skew) | Evaluated as given; event flagged `clockSkew: true` |
| EC-16 | Touched file with `core/file-size` 1 → 1 and `core/complexity` 3 → 2 | Pass: one metric fell, none rose |
| EC-17 | Touched file with `core/complexity` 3 → 1 and `core/function-size` 2 → 3 | Block "worse than recorded" for `core/function-size`; the drop elsewhere does not offset it |
| EC-18 | Metric key that is not a path (`ecosystem:name`) | Never "touched"; only the count rules apply |

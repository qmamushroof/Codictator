# 4.18 audit

**[◀ 4.17 llm](04-17-LLM.md)** · [SPEC index](../SPEC.md) · **[4.19 cli ▶](04-19-CLI.md)**

Total transparency (PRD §6 P5, §7.11): every verdict, injection, escalation, waiver, upgrade, tool run and integrity event is recorded, explainable and summarised. Nothing leaves the machine (PRD §6 P8).

## 4.18.1 Event log

`.codictator/state/events.jsonl` (git-ignored), one JSON object per line (schema §7.10), appended with a single `appendFile` call per event (lines < 64 KB, so concurrent hook processes never interleave). When the file exceeds 5 MiB it is renamed `events.<n>.jsonl`; the newest five are kept. In CI the log is written to the workspace and summarised (§4.18.4), not committed.

Events never contain file content, prompt text or tool output: only paths, rule ids, digests, sizes, durations, decisions and the agent message (already redacted, §4.3.7).

## 4.18.2 `explain`

`codictator explain <ruleId | eventId | CDX-E###>` prints:

| Id | Output |
|---|---|
| Rule | Statement, reason, tier, family, effective parameters with default, bound and any waiver, enforcer, layers, remediation, per-harness coverage from capability declarations |
| Event | The verdict, its inputs (config hash, pack versions, snapshot hash, `now`) and `codictator replay <eventId>` |
| Error code | Its §8 row |

## 4.18.3 `status`

One screen with the engine version, packs, and each harness's per-layer state (`active`, `inactive`, `unknown`, `unverified`) from capabilities and observed events. Below it: helper tool presence per required role (§4.6.6, from `config.tools` exact pins), active task and phase, waivers with days to expiry, ratchet totals and trend, dependency freshness, integrity state, open escalations and remediation progress (done / total, next step). When the `token-saver` role is satisfied by the engine itself (§4.6.6), the helper-tool row reads `token-saver: engine-satisfied` with live evidence: current budget band (`budget/current`), last scoped-injection hash/byte count, and read-dedupe block count from the event log; all-absent evidence is a finding, not a pass. `--json` emits the same as data for the extension.

## 4.18.4 CI summary

Markdown written to `GITHUB_STEP_SUMMARY` (or stdout), at most 60 KB; overflow lists counts and the command to see all. Order:

1. Integrity findings, then blocking findings with remediation.
2. Integrity exceptions and review identity notes (§4.10.4, §4.12.4).
3. Waivers in force and ratchet movement per rule.
4. Dependency report: vulnerable, deprecated, lag countdowns.
5. Remediation progress.
6. Unverifiable items: required check, external CI.


## 4.18.5 Metrics

`codictator report` computes PRD §10 metrics from local sources only:

| Metric | Source |
|---|---|
| Self-correction rate | A block followed by an allow for the same rule and task |
| Loop-breaker escalations per task | Escalation events |
| Tokens per task, band breaches | Only where `usageData` exists, else "unavailable" |
| p95 L1 and L3 latency, install-to-green time | Event timings |
| Ratchet totals | Baseline history (`git log` of `baseline.json`) |
| Muse Code and OpenCode layer coverage | Their capability declarations |

## 4.18.6 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Two hook processes append simultaneously | Both lines intact |
| EC-2 | Event line would exceed 64 KB | Message truncated with a marker before append |
| EC-3 | Log deleted mid-session | Recreated on next append; `status` notes the gap |
| EC-4 | `explain` unknown id | `CDX-E010` with the nearest known ids |
| EC-5 | Replay of an event whose pack version is no longer installed | `CDX-E011`, names the version needed |
| EC-6 | CI summary exceeds 60 KB | Truncated with counts |
| EC-7 | Harness without usage data | Token metrics "unavailable", never zero |

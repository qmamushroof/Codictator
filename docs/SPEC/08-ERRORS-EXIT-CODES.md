# 8. Errors and Exit Codes

**[◀ 7. Files and Formats](07-FILES-AND-FORMATS.md)** · [SPEC index](../SPEC.md) · **[9. Security and Performance ▶](09-SECURITY-PERFORMANCE.md)**

Every error is a `CdxError { code, message, detail?, remediation }` (§4.1.2). Codes are append-only (§1.4). Every message states what to do next; `codictator explain CDX-E###` prints the row. Rule findings are not errors: they carry rule ids and exit 1.

## 8.1 Error codes

| Code | Meaning | Exit |
|---|---|---|
| **E0xx** | **Prerequisites and CLI** | |
| `CDX-E001` | Node.js not on PATH | 6 |
| `CDX-E002` | Node.js older than the engine's `engines.node` | 6 |
| `CDX-E003` | Engine not installed at the root or tool dir | 6 |
| `CDX-E010` | Unknown rule, event or error id for `explain` | 2 |
| `CDX-E011` | Replay needs a pack version not installed | 6 |
| **E1xx** | **Configuration and the human path** | |
| `CDX-E101` | Config missing, unparseable or schema-invalid | 3 |
| `CDX-E102` | `config.codictator` ≠ installed engine | 3 |
| `CDX-E103` | Override or waiver of a floor rule | 3 |
| `CDX-E104` | Tunable looser than default outside a waiver | 3 |
| `CDX-E105` | Mandatory workflow gate removed or reordered, or an architecture change that loosens a profile rule or creates a cycle | 3 |
| `CDX-E106` | Literal secret in config, or key over plaintext HTTP | 3 |
| `CDX-E107` | Human-only command without a TTY or with agent markers | 4 |
| `CDX-E108` | Not a Codictator repo | 3 |
| `CDX-E109` | Waiver value beyond the pack bound | 3 |
| `CDX-E110` | Waiver expiry beyond `maxWaiverDays` or renewal chain too long | 3 |
| **E2xx** | **Packs, schemas, external tools** | |
| `CDX-E201` | Schema uses an unsupported keyword | 7 |
| `CDX-E202` | Duplicate rule id | 3 |
| `CDX-E203` | Configured pack missing or failing self-test | 3 |
| `CDX-E204` | Custom pack id or rule id collides with or impersonates a built-in | 3 |
| `CDX-E205` | Rule names an unknown enforcer | 3 |
| `CDX-E206` | Tool without an exact version pin | 3 |
| `CDX-E207` | External tool error, unknown exit code, unparseable or oversized output, path outside repo | 1 (blocks) |
| `CDX-E208` | External tool version ≠ pin | 1 (blocks) |
| `CDX-E209` | External tool not found | 1 (blocks) |
| `CDX-E210` | External tool mapped to a rule outside its pack | 3 |
| `CDX-E211`–`E216` | Self-test failures (§4.4.4) | 3 |
| **E3xx** | **Adapters and hook input** | |
| `CDX-E301` | Unknown or uninstalled harness id | 3 |
| `CDX-E302` | Custom adapter without passing contract tests | 3 |
| `CDX-E303` | Hook payload unparseable or missing required fields | 1 (blocks) |
| `CDX-E305` | Hook payload over 8 MiB | 1 (blocks) |
| `CDX-E306` | Shell command unparseable | 1 (blocks) |
| **E4xx** | **Dependencies** | |
| `CDX-E401` | Registry or advisory data unavailable and no usable snapshot | 5 |
| **E5xx** | **Integrity and CI** | |
| `CDX-E501` | Managed block markers malformed or duplicated | 1 (blocks) |
| `CDX-E503` | CI base commit unreachable (shallow clone) | 5 |
| **E6xx** | **Workflow, tests, remediation** | |
| `CDX-E601` | Red proof attempted after implementation began | 1 |
| `CDX-E602` | Declared test did not execute and fail | 1 |
| `CDX-E604` | Phase gate evidence missing | 1 |
| `CDX-E605` | Reviewer session not fresh | 1 |
| `CDX-E606` | More than one open task on a branch | 3 |
| `CDX-E607` | Review findings file invalid | 3 |
| `CDX-E608` | Remediation needs a clean work tree | 1 |
| `CDX-E609` | Rollback refused outside Codictator's step branches | 4 |
| **E7xx** | **Kernel I/O** | |
| `CDX-E701` | Write outside the repo root or temp dir | 1 (blocks) |
| `CDX-E702` | Network host not on the allowlist | 5 |
| `CDX-E703` | `git` missing or not a git repository | 6 |
| **E8xx** | **Audit and LLM** | |
| `CDX-E801` | Event log not writable (verdict blocked) | 7 |
| `CDX-E851` | No LLM configured for `--llm` | 3 |
| `CDX-E852` | LLM key missing or rejected | 5 |
| `CDX-E853` | LLM draft invalid after repair | 1 |
| `CDX-E854` | LLM unavailable (timeout, 429, 5xx after retries) | 5 |
| **E9xx** | **Enforcer runtime** | |
| `CDX-E901` | Enforcer or runtime threw | 7 |
| `CDX-E902` | Budget or time limit exceeded | 1 (blocks) |
| `CDX-E903` | Required data or tool for an enforcer unavailable | 5 |

## 8.2 Exit codes (all commands except `hook`)

| Exit | Meaning |
|---|---|
| 0 | Pass (allow or advise only) |
| 1 | Blocked: findings or a blocking error |
| 2 | Usage error |
| 3 | Configuration, pack or schema invalid |
| 4 | Needs a human (human-only command, active escalation) |
| 5 | Data unavailable (registry, network, git host, LLM) |
| 6 | Prerequisite or environment missing |
| 7 | Internal error |

`hook` exits with whatever its adapter's `reply` specifies (§4.5.4); errors inside `hook` become blocks, never a crash exit that a harness could treat as allow.

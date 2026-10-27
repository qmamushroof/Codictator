# 4.1 kernel

**[◀ 3. Architecture](03-ARCHITECTURE.md)** · [SPEC index](../SPEC.md) · **[4.2 config ▶](04-02-CONFIG.md)**

The only module that touches the operating system, the network or the clock (§3.3). Everything else receives ports by injection, which makes every other module testable without I/O and makes PRD §6 P1, P8 and P12 enforceable in one place.

## 4.1.1 Ports

| Port | Operations | Guarantees |
|---|---|---|
| `Fs` | `read`, `readText`, `write`, `append`, `stat`, `list`, `glob`, `exists`, `realpath`, `remove` | All paths resolved against the repo root; a write whose real path (after symlink resolution) leaves the repo root or the OS temp dir fails with `CDX-E701`. Writes are atomic (temp file + rename). Text is read as UTF-8; a BOM is stripped and reported to the caller |
| `Proc` | `run(argv, { cwd, env, stdin, timeoutMs, maxOutputBytes })` | `shell: false` always; argv array only; env built from an allowlist (§9.2); kills the process tree on timeout; returns `{ code, stdout, stderr, timedOut, truncated }` |
| `Net` | `request({ method, url, headers, body, timeoutMs })` | Host must be on the allowlist (§9.2), else `CDX-E702` and no socket is opened; HTTPS only; response size cap 32 MiB |
| `Clock` | `now()` | Injected; tests and replay pass a fixed instant |
| `Git` | `root`, `head`, `stagedFiles`, `diff(base, head)`, `show(rev, path)`, `config(key)`, `log(range)`, `isClean` | Implemented over `Proc` running `git`; never mutates history except where §4.13 runs on its own branch |
| `Env` | `get(name)` | Read-only view; used for harness variables and API-key lookup by name |

## 4.1.2 Utilities

| Utility | Contract |
|---|---|
| `Result<T>`, `CdxError` | `CdxError = { code: "CDX-E###"; message; detail?; remediation }` (§8) |
| `parseJson(text)` | Returns `Result<unknown>`; the only `JSON.parse` call in the codebase (§3.5) |
| `validate(schema, value)` | JSON Schema 2020-12 subset: `type`, `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `oneOf`, `$ref` (local). Unsupported keywords in a schema are a load error, never ignored |
| `sha256(bytes)` | Hex digest |
| `redactSecrets(text)` | Applies the secret detectors and value allowances of §4.7.1 and replaces each match with its first 4 characters plus `…(<length>)`. The detectors live here so `engine`, `audit`, `adapters` and `generator` redact without importing `security` (§3.3); `security` runs the same detectors for its rules |
| `normalizeText(text)` | CRLF and CR → LF, then hash; every content hash in §7 uses it, so Git's `autocrlf` cannot fake drift (§4.14) |
| `toRepoPath(p)` | POSIX-separated, repo-relative, case preserved; rejects `..` escapes |
| `globMatch(pattern, path)` | `*`, `**`, `?`, `{a,b}`, `[...]`; case-sensitive except on Windows and macOS default volumes, where the repo's case is canonical |
| `readTomlKeys`, `readYamlKeys` | Read only flat or one-level keys Codictator owns (Codex `[features]`, Dependabot `updates`, `pyproject` `[project]` dependencies); anything unparseable for those keys returns an error, never a guess |
| `readTestReport(xml)` | Minimal reader for JUnit XML and TRX: per test case id, title, outcome (`passed`, `failed`, `skipped`), so red and green proofs need no runner-specific parsing (§4.10.2) |
| `stableStringify(value)` | Sorted keys, 2-space indent, trailing newline; every generated JSON file uses it so regeneration is byte-identical |

## 4.1.3 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Write through a symlink pointing outside the repo | `CDX-E701`, nothing written |
| EC-2 | Path with `..` that normalises inside the repo | Allowed; normalised path used |
| EC-3 | Path differing only by case from an existing file on a case-insensitive volume | Treated as the existing file |
| EC-4 | Net request to a host not on the allowlist, including after an HTTP redirect | `CDX-E702`; redirects are followed only to allowlisted hosts |
| EC-5 | Child process exceeds `maxOutputBytes` | Killed; `truncated: true`; caller treats as error |
| EC-6 | Child process ignores SIGTERM on timeout | Tree killed (SIGKILL / `taskkill /T /F`) within 1 s |
| EC-7 | Same JSON value written twice | Byte-identical output |
| EC-8 | File with CRLF vs LF, otherwise identical | Same `normalizeText` hash |
| EC-9 | Malformed JSON | `Result` error with line and column; no throw |
| EC-10 | Schema uses an unsupported keyword | Load fails `CDX-E201` |
| EC-11 | `git` missing from PATH | `CDX-E703` with remediation |
| EC-12 | Non-UTF-8 file | Read as bytes; text enforcers skip it and report `binary-or-unknown-encoding` to the caller |
| EC-13 | `redactSecrets` on text holding a GitHub token and `process.env.TOKEN` | Token becomes its first 4 characters plus length; the env reference is unchanged |

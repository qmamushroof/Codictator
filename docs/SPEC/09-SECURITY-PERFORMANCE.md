# 9. Security and Performance

**[◀ 8. Errors and Exit Codes](08-ERRORS-EXIT-CODES.md)** · [SPEC index](../SPEC.md) · **[10. Testing Strategy ▶](10-TESTING-STRATEGY.md)**

Codictator's own posture (PRD §6 P8, §11.5, §11.8). Enforcement of security on target repos is §4.7.

## 9.1 Threat model

| Threat | Control |
|---|---|
| Agent disables or edits guardrails | Self-protection (§4.14.3), drift detection, CI as source of truth |
| Hostile hook input (crafted paths, huge payloads, injection strings) | Payload cap, schema parsing, no shell, path canonicalisation, analyser never executes (§4.7.2, §4.19.3) |
| Hostile repo content (custom pack code, external tools) | Runs with the repo's own trust, like any repo script; only in trusted VS Code workspaces; listed in `status` |
| Compromised dependency of Codictator | Zero runtime dependencies; exact dev pins; lockfile; `npm ci --ignore-scripts` |
| Compromised Codictator release | npm trusted publishing with provenance from tagged CI only; release runs the full verify; no install scripts |
| Data exfiltration | Network allowlist; no telemetry; no file content in logs |
| ReDoS from user or generated patterns | Pattern safety check (§9.2) |

## 9.2 Controls

| Control | Specification |
|---|---|
| No telemetry | No analytics, crash reporting or update checks; nothing is sent anywhere unless a feature below needs it |
| Network allowlist (kernel `Net`) | `registry.npmjs.org`, `api.nuget.org`, `pypi.org`, `api.osv.dev`, `nodejs.org`, `builds.dotnet.microsoft.com`, `www.python.org`, `api.github.com` (and the origin's GitHub Enterprise host when detected), hosts in `config.network.registries`, and the `config.llm.baseUrl` host for the generator process only. Everything else: `CDX-E702` before any socket opens |
| Child processes | `shell: false`, argv arrays, env from an allowlist (`PATH`, `HOME`, `USERPROFILE`, `SystemRoot`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`, `CI`, `GITHUB_*` in CI only) plus a tool's `envPass`; timeouts kill the tree |
| Secrets | Never logged, cached or echoed; findings redacted to prefix plus length; API keys read from env at call time only; `.env`-class files never read by Codictator itself |
| Patterns | Every regex from a pack, config or generator is checked before use: length ≤ 1,000, no nested quantifiers over overlapping groups (`(a+)+`-class), no backreferences; matching runs per line with a 10 ms per-file budget |
| Files | Atomic writes; writes confined to repo and temp; generated files never executable except git hooks and the launcher |
| Supply chain of Codictator | `npm ci --ignore-scripts` everywhere; `package-lock.json` committed; GitHub Actions pinned by SHA; published tarball contains only `dist/`, `schema/`, `README.md`, `LICENSE` (an allowlist in `files`); releases signed with npm provenance |
| Vulnerability reports | `SECURITY.md` at repo root with a private reporting channel (GitHub security advisories) |

## 9.3 Performance budgets

Measured on a reference repo (10,000 files, 2,000 source files) on a 4-core CI runner; enforced by stress tests (§10.5); reported as p95 from event timings (PRD §10). Budgets bound in-process work only; harness process-spawn and runtime-startup costs are excluded (they measure the harness, not the product).

| Path | Budget (p95) | Hard time limit |
|---|---|---|
| Hook process start to reply, `tool.pre.*` (warm cache) | 150 ms | `min(harness timeout − 1 s, 5 s)` |
| `tool.post.write` | 500 ms | same |
| `session.start` / `prompt.submit` injection | 300 ms | same |
| `git pre-commit` (≤ 50 staged files) | 5 s | 60 s |
| `git commit-msg` | 300 ms | 10 s |
| `git pre-push` | 60 s | 300 s |
| `ci.verify` (excluding the repo's own build and tests) | 3 min | job timeout |
| Event append | 5 ms | — |
| Extension view refresh after an event | 1 s | — |

Techniques the budgets assume: effective-config cache (§4.19.3), graph cache keyed by content hash (§4.11.3), lazy module import per trigger, scope limited to the tool call or staged files, registry snapshot reuse at L1/L3 (§4.8.4), concurrency capped at available parallelism.

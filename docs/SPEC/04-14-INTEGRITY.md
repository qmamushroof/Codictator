# 4.14 integrity

**[◀ 4.13 remediation](04-13-REMEDIATION.md)** · [SPEC index](../SPEC.md) · **[4.15 ci ▶](04-15-CI.md)**

The guardrail lockfile, drift and tamper detection, self-protection and git-hook installation (PRD §7.7, §8 F16, §11.1).

## 4.14.1 Manifest

`.codictator/manifest.json` (schema §7.14) lists every generated artifact with its `path`, `owner` (adapter, pack or module id), `mode` and `hash`. `mode` is `file` (whole file), `block` (managed Markdown block) or `entries` (owned entries in a shared JSON/TOML/YAML file). `hash` is the `sha256` of `normalizeText` of the file, the block, or the canonical projection of owned entries. Generation is deterministic (`stableStringify`, no timestamps), so `regen` on unchanged config reproduces the manifest byte for byte.

## 4.14.2 Checks

| Rule | Detects | Layers |
|---|---|---|
| `core/guardrail-manifest` | Missing artifact, hash mismatch, artifact not in manifest, manifest itself edited outside `regen` (its own hash recomputed from entries) | L0 (session start), L3, L4 |
| `core/hooks-active` | Local `core.hooksPath` not pointing at the installed hooks dir, hook file not executable (POSIX), any harness config containing a disable switch (`disableAllHooks`, removed owned entries) | L0, L3, L4 |
| `core/engine-version-match` | Installed engine ≠ `config.codictator`; launcher missing | L0, L3, L4 |
| `core/no-bypass` | L4: a non-merge commit in range without the `Codictator-L3:` trailer that `commit-msg` adds (value: short config hash), unless its author is in `config.integrity.trailerExempt` (bot accounts). L1: the self-protection blocks of §4.14.3 | L1, L4 |

Every integrity finding is floor, emits an `integrity` event, and is listed first in the CI summary. L0 detection at session start blocks all tool calls except `codictator regen`, `codictator status` and reads, so an agent repairs guardrails before working.

## 4.14.3 Self-protection (L1, `core/no-bypass`)

| Target | Blocked for agents |
|---|---|
| Paths | Writes, moves or deletes of `.codictator/**` (all state changes go through `codictator` commands), every manifest artifact, `.githooks/**`, Codictator's block in `.husky/*`, `.github/workflows/codictator*.yml`, and edits to harness config files that change owned entries |
| Manifests | A `package.json` (or tool manifest, §4.19.4) write that removes or changes the `codictator` dev dependency |
| Commands | `git commit --no-verify`/`-n`, `git push --no-verify`, `HUSKY=0`, `SKIP=…`, `git -c core.hooksPath=…`, `git config core.hooksPath`, `chmod -x` on hooks, `rm`/`mv`/`git rm` on protected paths, `gh workflow disable`, `gh api` writes to branch protection or rulesets, `npm uninstall codictator`, and human-only `codictator` commands (§4.19.2) |

Commands are matched by the shell analyser (§4.7.2), so wrappers (`bash -c`, `$(…)`, `env X=…`) do not hide them. There is no environment variable, flag or file that turns Codictator off.

## 4.14.4 Git hooks

`init` and `codictator install-hooks` write `.githooks/pre-commit`, `commit-msg`, `pre-push` (POSIX `sh`, mode 755) and set `git config core.hooksPath .githooks`; npm repos also get `"prepare": "codictator install-hooks"` so a fresh `npm ci` reinstalls them. If `.husky/` exists, Codictator inserts a managed block into Husky's hook files instead; if `core.hooksPath` already points elsewhere, it inserts blocks into that directory's hooks. Each hook: verify `node` is on PATH and meets the minimum (§4.19.4), else print `CDX-E001`/`CDX-E002` and exit 1; then `exec node <root>/.codictator/bin/run.mjs git <hook> "$@"`.

## 4.14.5 The change path

Guardrails change only by changing config (human, §4.2.3) followed by `codictator regen`, which rewrites artifacts and the manifest and records a `guardrail` history entry. `regen` itself is allowed for agents: it can only restore what config already says.

## 4.14.6 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Agent writes `.codictator/waivers.json` | Block at L1 |
| EC-2 | Human deletes `.githooks/pre-commit` | L0 and L4 report; L3 cannot (it is gone) |
| EC-3 | `git commit --no-verify` by a human | Commit lacks trailer → L4 blocks the PR via `core/no-bypass` |
| EC-4 | Commit made in the GitHub web editor | No trailer → L4 blocks unless author exempt; remediation: make the change locally |
| EC-5 | Line endings converted by `autocrlf` | Hashes unaffected (normalised) |
| EC-6 | User adds own entry to `.claude/settings.json` | Not drift (outside projection) |
| EC-7 | Codictator's CI workflow file deleted | L4 cannot run it; other runs and L0/L3 report; required-check rule fails the merge (§4.15.2) |
| EC-8 | `bash -c "git commit -n -m x"` | Block |
| EC-9 | `core.hooksPath` reset to default by a tool | `core/hooks-active` at L0; `codictator install-hooks` fixes |
| EC-10 | Manifest lists a file the user legitimately deleted with its harness | Drift until config drops the harness and `regen` runs |
| EC-11 | Two `regen` runs on different OSes | Identical bytes |
| EC-12 | Hook file not executable on Linux after a Windows commit | `core/hooks-active` reports; `.gitattributes`/`git update-index --chmod=+x` remediation |

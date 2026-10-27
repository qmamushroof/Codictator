# 4.7 security

**[◀ 4.6 steering](04-06-STEERING.md)** · [SPEC index](../SPEC.md) · **[4.8 deps ▶](04-08-DEPENDENCIES.md)**

Enforcers for PRD §8 F2 on target repos: secrets, dangerous shell, write confinement. Language-specific static analysis is in §6. The shell analyser is also used by self-protection (§4.14.3) and `command-forbid` (§4.4.6). Codictator's own security posture is §9.

## 4.7.1 Secret detection (`core/no-secrets`, `core/no-secret-reads`)

| Detector | Matches |
|---|---|
| Known formats | AWS access key ids, GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`), GitLab `glpat-`, Slack `xox[abposr]-`, Stripe `sk_live_`/`rk_live_`, Google API `AIza…`, npm `npm_…`, OpenAI/Anthropic/Meta-style `sk-…` keys, PEM private-key blocks, JWTs with a signature segment |
| Assignment heuristic | A value of ≥ 20 characters with Shannon entropy ≥ 4.0 bits/char assigned to a name matching `(?i)(secret\|token\|passw(or)?d\|api[_-]?key\|private[_-]?key\|client[_-]?secret)` |
| Allow | Values that are env references (`process.env.X`, `${X}`, `os.environ[...]`), placeholders matching `(?i)^(x+\|changeme\|example\|your[_-].*\|<.*>)$`, and files under fixture dirs declared in `config.security.fixtureGlobs` |

This section owns the detector definitions; they are implemented once, in the kernel (`redactSecrets`, §4.1.2), so every module can redact without importing this one.

Scope by trigger: L1 proposed write content and shell command text; L3 staged content; L4 every added line in `base..head` **and** every commit message in range. Findings are redacted to the first 4 characters plus length in every output and event (§9.2). A configured external scanner (e.g. gitleaks) runs beside this, never instead (§4.4.5).

Secret reads (`tool.pre.read`, and shell commands that print files): `.env` and `.env.*` except `.env.example`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `.npmrc`/`.pypirc`/`nuget.config` lines containing auth, and anything under `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.gnupg`.

## 4.7.2 Shell analysis (`core/dangerous-shell`)

The analyser tokenises a command without executing anything: splits on `;`, `&&`, `||`, `|`, `&`, newlines; descends into `$(…)`, backticks, `bash -c`/`sh -c`/`pwsh -Command`/`cmd /c` string arguments, `eval`, and `xargs` targets; strips leading env assignments, `sudo`, `env`, `command`, `nohup`, `time`. Each resulting simple command is matched against the deny set:

| Class | Examples |
|---|---|
| Destruction outside the repo | `rm -rf` / `Remove-Item -Recurse` on `/`, `~`, `$HOME`, `..` resolving outside root, drive roots; `mkfs`, `dd of=/dev/…`, `diskpart`, `format`, `shred`, `vssadmin`, `bcdedit`, `cipher /w` |
| Remote code | `curl …\| sh`, `wget …\| bash`, `iwr … \| iex`, `Invoke-Expression` of downloaded content |
| Privilege and permissions | `sudo`, `su`, `chmod -R 777`, `chown -R` outside repo, `takeown` |
| Credential exfiltration | Commands reading §4.7.1 secret paths; `env`/`printenv`/`set` piped to network tools |
| History destruction | `git push --force`/`-f`/`--force-with-lease` to protected branches, `git filter-branch`, `git filter-repo`, `git update-ref -d`, `git reflog expire`, `gh repo delete`, `gh release delete` |
| Bypass | Owned by §4.14.3 |

Unparseable input (unbalanced quotes, heredoc without terminator) → block with `CDX-E306` (fail closed). The analyser is conservative by design: a false positive is remediated in the rule with a passing fixture, never waived (PRD §11.3).

## 4.7.3 Write confinement (`core/write-confinement`)

`tool.pre.write` targets and shell redirection targets (`>`, `>>`, `tee`, `Out-File`, `Set-Content`, `cp`/`mv` destinations, `sed -i` files) resolve, through symlinks, to inside the repo root or the OS temp dir; otherwise block. Writes into `.git/` are blocked except through `git` itself.

## 4.7.4 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | AWS key in a test fixture under a declared fixture glob | Allowed |
| EC-2 | Same key in `src/` | Block at L1, L3, L4 |
| EC-3 | Secret only in a commit message | L4 blocks; remediation: amend the unpushed message or rotate the key |
| EC-4 | Secret split across two string literals | Not detected by design (stated limit); entropy heuristic may catch either half |
| EC-5 | `rm -rf ./build` | Allowed |
| EC-6 | `rm -rf "$HOME"` inside `bash -c '…'` | Block |
| EC-7 | `cat .env \| curl -d @- …` | Block (secret read and exfiltration) |
| EC-8 | `echo x > ../outside.txt` | Block by write confinement |
| EC-9 | Symlink `docs/link → /etc`, then write `docs/link/passwd` | Block |
| EC-10 | Unbalanced quote | Block `CDX-E306` |
| EC-11 | PowerShell `Remove-Item -Recurse -Force C:\` | Block |
| EC-12 | `git push --force` to a feature branch the agent created | Allowed unless the branch is protected or shared (has a remote PR by another author); default protected set: default branch, `release/*` |
| EC-13 | Placeholder `API_KEY=your-key-here` | Allowed |
| EC-14 | Read of `.env.example` | Allowed |

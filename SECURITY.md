# Security policy

## Reporting a vulnerability

Report privately through GitHub: the repository's **Security** tab → **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include the affected package (`codictator` or the `codictator-vscode` extension) and version, the harness and OS, reproduction steps, and the impact you expect. A report about a guardrail bypass is a vulnerability: an agent or a change that gets past a floor rule without a visible trace is in scope.

## Scope

| In scope | Out of scope |
|---|---|
| The npm package `codictator`: engine, CLI, launcher, generated hooks and CI workflow | Vulnerabilities in a target repo's own code or dependencies, which Codictator reports rather than owns |
| The `codictator-vscode` extension | A harness's own hook or sandbox defects; report those to the harness vendor |
| Ways to disable, edit or skip a guardrail silently (PRD §11.1 states the accepted limit) | Removal by someone with admin rights, which is loud by design |

## Supported versions

Only the latest published release receives fixes. Nothing is published yet.

## Disclosure

Fixes ship as a new release with a GitHub security advisory that credits the reporter unless they ask otherwise. Codictator's own security controls are SPEC §9.

# 1. Scaffold

**[◀ How to Use](00-HOW-TO-USE.md)** · [Roadmap index](../ROADMAP.md) · **[2. Red Suite ▶](02-RED-SUITE.md)**

| | |
|---|---|
| **Depends on** | PRD, SPEC and pre-development docs merged |
| **Delivers** | A workspace that installs, type-checks, lints and tests on Windows, macOS and Linux; the red-ledger runner; CI as the required check on `main` |
| **Read** | SPEC §2, §3.1, §3.2, §3.5, §5.11, §9.2, §10.2, §10.6, §10.7; [VALIDATION.md](../VALIDATION.md); [CONVENTIONS.md](../CONVENTIONS.md) |
| **Covers** | §10.3 items 2, 3, 4 and 6 (green from here on); the runner's own tests |

## Steps

- [ ] **1.1** The repo root holds only files allowed by `core/repo-hygiene` and `core/doc-placement`. Verify: list the root against SPEC §4.9.2 and §5.11.
- [ ] **1.2** `.gitignore` (`node_modules`, `dist`, `coverage`, `.codictator/state/`, `.codictator/cache/`, `.codictator/tool/node_modules/`) beside the `.gitattributes` of the first commit (`* text=auto eol=lf`). Verify: `git check-ignore` on each path; `git ls-files --eol` shows no CRLF in the index.
- [ ] **1.3** `.nvmrc` and root `package.json`: private, npm workspaces, `packageManager`, the SPEC §2.2 dev dependencies at exact pins re-checked against the registry, and the scripts of VALIDATION. `package-lock.json` committed. Verify: `npm ci --ignore-scripts` from a clean clone.
- [ ] **1.4** `tsconfig.base.json` per SPEC §3.5 and one `tsconfig.json` per package; `biome.json` enforcing the CONVENTIONS lint rules (no `any`, no non-null assertion, no default export, kebab-case file names). Verify: `npm run typecheck`, `npm run lint`.
- [ ] **1.5** Package manifests: `packages/codictator` (name, `bin`, `type: module`, `engines`, zero dependencies, `files` allowlist of SPEC §9.2) and `packages/vscode` (shape of SPEC §4.20.1). Verify: `npm pack --dry-run -w codictator` lists only allowlisted paths.
- [ ] **1.6** Red-ledger runner and `npm run ledger`, written test-first. Its tests prove each failure mode of SPEC §10.7: a listed test passing, an unlisted test failing, a listed test absent, a pre-existing test newly listed. Verify: `npm test`.
- [ ] **1.7** Architecture tests for every SPEC §10.3 item under `tests/architecture/`. Item 1 waits for the arch module (phase 7) and item 5 for the phase 2 contracts; both enter the ledger red. Verify: `npm test`.
- [ ] **1.8** `.github/workflows/test.yml`: `pull_request` and `push` to `main`; permissions `contents: read`; checkout with `persist-credentials: false` and full history; matrix of the three OSes; Node from `.nvmrc`; the VALIDATION always-set plus the ledger base comparison. Every `uses:` pinned to a full commit SHA found by lookup (`core/ci-actions-pinned`). Verify: CI green on the PR.
- [ ] **1.9** Human: protect `main` with the workflow's check required, force-push and deletion blocked, and squash merging disabled (`core/branch-protection`, SPEC §11 S33). Verify: the repo's ruleset settings page.

## Exit gate

- `npm ci --ignore-scripts`, then the VALIDATION always-set, green in CI on all three OSes.
- `npm run ledger -- --covers "§10.3"` lists only the tests of items 1 and 5.
- A pull request with a deliberately failing unlisted test is blocked by the required check (then closed).

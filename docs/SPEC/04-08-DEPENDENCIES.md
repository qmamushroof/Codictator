# 4.8 deps

**[◀ 4.7 security](04-07-SECURITY-GUARDS.md)** · [SPEC index](../SPEC.md) · **[4.9 records ▶](04-09-RECORDS.md)**

Implements PRD §7.5, §8 F3 and decisions #14, #15, #28. Versions come from registries and advisory data, never from an LLM (PRD §12 #3). Thresholds are §5 F3 rows; per-ecosystem manifest rules are §6.

## 4.8.1 Model

A language pack supplies a `Driver` per ecosystem (§3.4): it finds manifests and lockfiles, lists `Dependency { ecosystem, name, pinned, kind (prod | dev | peer | toolchain | action | image), manifestPath }`, and produces file edits for an upgrade. Toolchains (`.nvmrc`, `packageManager`, `global.json`, `.python-version`), CI actions (`uses:`) and container images (`FROM`, `image:`) are dependencies too.

## 4.8.2 Data sources

| Data | Source |
|---|---|
| npm versions, publish times, `deprecated`, license | `GET https://registry.npmjs.org/<name>` (full document; the abbreviated form lacks `time`) |
| NuGet versions, listing, deprecation, license | `https://api.nuget.org/v3/registration5-gz-semver2/<id>/index.json` |
| PyPI versions, upload times, yanked, license | `https://pypi.org/pypi/<name>/json` |
| Advisories, all ecosystems | `POST https://api.osv.dev/v1/querybatch`, then `GET /v1/vulns/<id>` for affected ranges |
| Node, .NET, Python toolchains | Official release indexes: `https://nodejs.org/dist/index.json`, .NET `releases-index.json`, python.org release API (§6) |
| GitHub Actions | GitHub REST releases and tags of the action's repo, resolved to a commit SHA |

One advisory source (OSV) covers every ecosystem, so there is one capability with one provider. All calls go through the net port allowlist (§9.2).

## 4.8.3 "Latest stable"

For a dependency, the **eligible set** is every version that is:

- not a prerelease (SemVer prerelease, PEP 440 pre/dev, NuGet prerelease);
- not deprecated, yanked or unlisted;
- published at least `minReleaseAgeDays` before `now`;
- free of any OSV advisory affecting it;
- compatible with the pinned runtime (`engines`, `requires-python`, target framework).
 **Latest stable** is the maximum of the eligible set by the ecosystem's version order. For toolchains, the set is restricted to LTS/supported lines.

**Security exemption (§11 S9).** A version younger than `minReleaseAgeDays` is eligible when the currently pinned version has an advisory that this version fixes, and it is the newest version doing so within the same major. Without this, the age rule would hold a repo on a known-vulnerable version.

## 4.8.4 Registry snapshot

Each run stores the fetched documents it used in `.codictator/cache/registry/<ecosystem>.json` (git-ignored, schema §7.12) with `fetchedAt`; the snapshot hash enters every verdict (§4.3.6).

| Layer | Freshness | When data is missing |
|---|---|---|
| L1, L3 | Reuse snapshot younger than 24 h; dependency rules run only when a manifest, lockfile or toolchain file is in scope | Offline: use the last snapshot and say "as of <fetchedAt>"; no snapshot → block dependency changes with `CDX-E401` (PRD §7.5) |
| L4, L5 | Always fetch fresh | Fetch failure → `CDX-E401`, block (fail closed) |

## 4.8.5 Verdicts

| Situation | Rule | Verdict |
|---|---|---|
| Range, tag, `*`, `latest`, git URL without a commit SHA, unpinned action or image | `core/dep-exact-pin` | Block |
| Lockfile missing or out of sync with the manifest | `core/dep-lockfile` | Block |
| Pinned version has an OSV advisory | `core/dep-no-vulnerable` | Block, zero allowance (PRD §12 #15); remediation names the minimal fixed version and the latest stable |
| Pinned version deprecated or yanked | `core/dep-no-deprecated` | Block |
| Behind latest stable | `core/dep-latest-stable` | Pass until lag exceeds `lagDays` (same major available) or `majorLagDays` (only newer majors); then block. Lag = `now` − the moment the oldest newer eligible version became eligible |
| New dependency without a recorded reason and ladder rung | `core/dep-new-needs-reason` | Block (§4.9.3 record field `deps.added`) |
| A second package for a capability already provided by a package or by the pinned platform | `core/dep-one-per-capability` | Block; capability catalogues are per pack (§6) |
| License not in the policy list | `core/dep-license` | Block |
| Toolchain not on the latest stable LTS patch line, past lag | `core/dep-latest-stable` (kind `toolchain`) | Same lag rules |

## 4.8.6 Upgrade bots (PRD §12 #28)

Detection: `renovate.json`, `renovate.json5`, `.github/renovate.json(5)`, `.renovaterc*` → Renovate; `.github/dependabot.yml` → Dependabot; neither → Codictator upgrades (§4.8.7). `init` generates Renovate config if neither exists and the user picks Renovate; otherwise it adds owned keys to the existing file.

| Bot | Owned keys (values from effective config) |
|---|---|
| Renovate | `rangeStrategy: "pin"`, `minimumReleaseAge: "<n> days"`, `vulnerabilityAlerts.minimumReleaseAge: null` (S9), `osvVulnerabilityAlerts: true`, `pinDigests: true`, `extends` includes `helpers:pinGitHubActionDigests`, `separateMajorMinor: true`, `lockFileMaintenance.enabled: true`, `dependencyDashboard: true` |
| Dependabot | One `updates` entry per detected ecosystem plus `github-actions`, each with `schedule.interval: daily`, `cooldown.default-days: <n>`; npm entries `versioning-strategy: increase` |

Bot PRs are dependency-only changes (§4.12.6): the CI job appends the history entry to same-repo bot branches (§4.15.3); Codictator's verdict decides the merge, never the bot.

## 4.8.7 Codictator's own upgrade changes

When no bot is present, the L5 sweep runs `codictator deps upgrade --pr`: one branch `codictator/deps/<ecosystem>/<name>-<version>` and one PR per dependency, grouping patch and minor of the same package line. Each PR holds the manifest edit, the lockfile regenerated by the ecosystem tool (e.g. `npm install --package-lock-only --ignore-scripts`) and its history entry. Majors are not opened as single PRs; they become remediation chains (§4.13.5). PRs are opened through the git host API with the CI token; nothing is pushed to the default branch.

## 4.8.8 Edge cases

| EC | Case | Expected |
|---|---|---|
| EC-1 | Newest version is 2 days old, previous is 30 days | Latest stable = previous |
| EC-2 | Pinned has advisory; fix released yesterday | Fix eligible via S9; block remediation names it |
| EC-3 | Every newer version has an advisory | Latest stable = pinned if pinned is clean; if pinned is also affected: block, remediation "replace or remove", escalation to human |
| EC-4 | Package unpublished from the registry | Block `core/dep-no-deprecated` with "unpublished" |
| EC-5 | Registry returns 429/5xx at L4 | Retry ×2 with backoff (1 s, 4 s), then `CDX-E401` block |
| EC-6 | `engines`, `peerDependencies` ranges, `requires-python` | Compatibility declarations, not pins: exempt from `core/dep-exact-pin`, but must be satisfied by the pinned toolchain |
| EC-7 | Git dependency pinned by full SHA | Allowed; latest-stable check skipped, reported as "unversioned source" in `status` |
| EC-8 | Private registry (scoped `.npmrc` registry) | Host must be added to `config.network.registries`; otherwise `CDX-E702` and block |
| EC-9 | Major released 10 days ago, `majorLagDays` 60 | Pass; `status` shows the countdown |
| EC-10 | Workspace monorepo pins different versions of one package | Each manifest judged separately; one-per-capability counts the package once |
| EC-11 | Advisory withdrawn in OSV | Next fresh fetch clears the finding |
| EC-12 | Prerelease pinned deliberately | Block (not stable); no waiver (floor) |
| EC-13 | `uuid` added while pinned Node provides `crypto.randomUUID` | Block `core/dep-one-per-capability` (platform first) |
| EC-14 | Clock earlier than a version's publish time | Version not eligible (age negative) |
| EC-15 | Renovate config exists with `rangeStrategy: "bump"` | Owned key rewritten to `pin` on `regen`; until then drift finding |

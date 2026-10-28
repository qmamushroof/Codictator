// SPEC §4.8: dependency enforcers, bot config, upgrades. Owns the §7.12
// registry snapshot format. The npm driver logic lives in this module as
// pure functions over caller-supplied text and ports (npm, lockfile, npmrc,
// registry, osv, osv-ranges, stable, selection, capabilities, eval, verdicts,
// snapshot-verdicts, bots, renovate, dependabot, fields); a Driver instance
// that reads the repo and the pack-rule binding both wait for gate-closure
// wiring with ports (SPEC §3.3, §3.4), like the deferred enforcers of later
// phases.
import type { Result } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";
import type { NpmDepKind } from "./npm.ts";
import { isExactNpmPin } from "./npm.ts";
import type { ResolveOptions } from "./selection.ts";
import { selectLatestStable } from "./selection.ts";
import { evaluateDepVerdicts, manifestToEval } from "./verdicts.ts";

export interface ManifestDependency {
	readonly name: string;
	readonly range: string;
	readonly kind?: NpmDepKind;
}

export interface Manifest {
	readonly ecosystem: string;
	readonly path: string;
	readonly dependencies: ReadonlyArray<ManifestDependency>;
}

export interface RegistryVersion {
	readonly published: string;
	readonly deprecated?: boolean;
	readonly yanked?: boolean;
	readonly license?: string;
	readonly engines?: string;
}

// SPEC §7.12: advisories keyed `name@version` holding OSV ids.
export interface RegistrySnapshot {
	readonly version: 1;
	readonly ecosystem: string;
	readonly fetchedAt: string;
	readonly packages: Readonly<
		Record<
			string,
			{ readonly versions: Readonly<Record<string, RegistryVersion>> }
		>
	>;
	readonly advisories: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface FileEdit {
	readonly path: string;
	readonly old: string;
	readonly replacement: string;
}

// SPEC §3.4: ecosystem driver contract.
export interface Driver {
	readonly ecosystem: string;
	readonly detect: (repo: string) => boolean;
	readonly readManifests: (repo: string) => Array<Manifest>;
	readonly registry: RegistryClient;
	readonly edit: (upgrade: Upgrade) => Array<FileEdit>;
}

export interface Upgrade {
	readonly name: string;
	readonly from: string;
	readonly to: string;
}

export interface RegistryClient {
	readonly snapshot: (
		names: ReadonlyArray<string>,
	) => Promise<Result<RegistrySnapshot>>;
}

// SPEC §4.8.3: latest-stable resolution against the snapshot. Ages measure
// from fetchedAt, so repeated runs observe the same instant (SPEC §10.3).
export function resolveLatest(
	snapshot: RegistrySnapshot,
	name: string,
	options: ResolveOptions = {},
): Result<string> {
	const selected = selectLatestStable(snapshot, name, options);
	if (!selected.ok) {
		return selected;
	}
	return { ok: true, value: selected.value.version };
}

// SPEC §4.8.5: the manifest-intrinsic verdicts for the evaluation path.
// Anything needing the snapshot, lockfile bytes or bot files runs in
// evaluateDepVerdicts once the enforcer layer supplies them; without that
// data this reports only what the ranges themselves prove, never a guess.
export function checkDeps(
	ctx: CheckContext,
	manifests: ReadonlyArray<Manifest>,
): Promise<Array<Finding>> {
	const evaluated = evaluateDepVerdicts({
		manifests: manifests.map(manifestToEval),
		now: ctx.now,
	});
	const intrinsic: Array<Finding> = [];
	for (const finding of evaluated.findings) {
		if (finding.ruleId === "core/dep-exact-pin") {
			intrinsic.push(finding);
		}
	}
	for (const manifest of manifests) {
		for (const dep of manifest.dependencies) {
			if (!isExactNpmPin(dep.range)) {
				continue;
			}
			const parsed = dep.range.replace(/^v/, "");
			if (/-/.test(parsed) && !/^\d+\.\d+\.\d+$/.test(parsed)) {
				intrinsic.push({
					ruleId: "core/dep-latest-stable",
					path: manifest.path,
					message: `${dep.name}@${dep.range} in ${manifest.path} is a prerelease, never stable`,
					remediation: `Pin ${dep.name} to a stable release.`,
				});
			}
		}
	}
	return Promise.resolve(intrinsic);
}

export {
	detectUpgradeBots,
	isDependabotFile,
	isRenovateFile,
	type UpgradeBot,
	upgradeBranchName,
} from "./bots.ts";
export {
	capabilityOf,
	DEFAULT_LICENSE_ALLOW,
	platformCapabilityCover,
} from "./capabilities.ts";
export {
	checkDependabotOwnedKeys,
	type DependabotUpdateEntry,
	parseDependabotUpdates,
} from "./dependabot.ts";
export {
	type DepEvalInput,
	type DepEvaluation,
	type EvalDep,
	type EvalManifest,
	pinFinding,
	type UniqueDep,
	uniqueDeps,
} from "./eval.ts";
export {
	lockfileMismatches,
	type NpmLockfile,
	parsePackageLock,
} from "./lockfile.ts";
export {
	classifyNpmRange,
	isExactNpmPin,
	isExactToolchainPin,
	isUnversionedNpmSource,
	NPM_ECOSYSTEM,
	type NpmDependency,
	type NpmDepKind,
	type NpmManifest,
	type NpmPinForm,
	parsePackageJson,
	parseToolchainFiles,
} from "./npm.ts";
export {
	NPM_PUBLIC_REGISTRY_HOST,
	type NpmRegistryRef,
	type NpmrcConfig,
	parseNpmrc,
	privateRegistryHosts,
} from "./npmrc.ts";
export {
	fetchOsvAdvisoryIds,
	fetchOsvRanges,
	isRetryableStatus,
	narrowOsvRanges,
	OSV_BASE_URL,
	OSV_TIMEOUT_MS,
	type OsvEvent,
	type OsvFetchOptions,
	type OsvRange,
	osvAdvisoryAffects,
	osvRangeAffectsVersion,
	retryDelaysMs,
} from "./osv.ts";
export {
	buildSnapshot,
	fetchNpmPackument,
	hashSnapshot,
	NPM_REGISTRY_BASE_URL,
	type NpmDocVersion,
	type NpmPackument,
	REGISTRY_TIMEOUT_MS,
	type RegistryFetchOptions,
	SNAPSHOT_CACHE_PATH,
	SNAPSHOT_MAX_AGE_MS,
	type SnapshotFreshness,
	snapshotAsOf,
	snapshotFreshness,
} from "./registry.ts";
export {
	checkRenovateOwnedKeys,
	expectedRenovateKeys,
	parseRenovateText,
	type RenovateOwnedKeys,
} from "./renovate.ts";
export {
	type EligibleVersion,
	eligibleStableVersions,
	lagDaysFor,
	type ResolveOptions,
	selectLatestStable,
	snapshotAdvisoriesFor,
} from "./selection.ts";
export {
	checkPinnedVerdicts,
	minimalFixedVersion,
	type PinnedCheckInput,
	pinnedOrUnversionedNote,
	snapshotForm,
} from "./snapshot-verdicts.ts";
export {
	compareNpmVersions,
	DEFAULT_DEP_LAG_PARAMS,
	DEFAULT_LAG_DAYS,
	DEFAULT_MAJOR_LAG_DAYS,
	DEFAULT_MIN_RELEASE_AGE_DAYS,
	type DepLagParams,
	isNpmPrerelease,
	MS_PER_DAY,
	parseNpmVersion,
	type SemVer,
} from "./stable.ts";
export {
	depErrorFinding,
	evaluateDepVerdicts,
	makeDepError,
	manifestToEval,
} from "./verdicts.ts";

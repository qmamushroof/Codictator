// SPEC §4.8.3: "latest stable" selection with the S9 security exemption.
// Eligibility is pure over the §7.12 snapshot; ages measure from the
// snapshot's fetchedAt ("as of fetchedAt", §4.8.4), never the wall clock.
import {
	err,
	type Fs,
	makeError,
	type Net,
	ok,
	type Result,
} from "../../kernel/index.ts";
import type { RegistrySnapshot, RegistryVersion } from "./index.ts";
import {
	compareNpmVersions,
	DEFAULT_DEP_LAG_PARAMS,
	type DepLagParams,
	MS_PER_DAY,
	parseNpmVersion,
	type SemVer,
} from "./stable.ts";

export interface ResolveOptions {
	readonly pinned?: string;
	readonly params?: Partial<DepLagParams>;
	readonly satisfiesRuntime?: (version: RegistryVersion) => boolean;
	readonly net?: Net;
	readonly fs?: Fs;
}

function withDefaults(params: Partial<DepLagParams> | undefined): DepLagParams {
	return {
		lagDays: params?.lagDays ?? DEFAULT_DEP_LAG_PARAMS.lagDays,
		majorLagDays: params?.majorLagDays ?? DEFAULT_DEP_LAG_PARAMS.majorLagDays,
		minReleaseAgeDays:
			params?.minReleaseAgeDays ?? DEFAULT_DEP_LAG_PARAMS.minReleaseAgeDays,
	};
}

// SPEC §7.12: advisories are keyed name@version holding OSV ids.
export function snapshotAdvisoriesFor(
	snapshot: RegistrySnapshot,
	name: string,
	version: string,
): ReadonlyArray<string> {
	const found = snapshot.advisories[`${name}@${version}`];
	return found ?? [];
}

function ageDays(published: string, nowMs: number): number | undefined {
	const publishedMs = Date.parse(published);
	if (Number.isNaN(publishedMs)) {
		return undefined;
	}
	return (nowMs - publishedMs) / MS_PER_DAY;
}

// SPEC §11 S9: a version younger than minReleaseAgeDays is eligible when the
// pinned version has an advisory that this version fixes — newer, same major,
// and free of every advisory affecting the pinned version.
function securityExempt(
	snapshot: RegistrySnapshot,
	name: string,
	pinned: string,
	pinnedParsed: SemVer,
	candidate: string,
	candidateParsed: SemVer,
): boolean {
	if (
		compareNpmVersions(candidateParsed, pinnedParsed) <= 0 ||
		candidateParsed.major !== pinnedParsed.major
	) {
		return false;
	}
	const pinnedAdvisories = snapshotAdvisoriesFor(snapshot, name, pinned);
	if (pinnedAdvisories.length === 0) {
		return false;
	}
	const candidateAdvisories = snapshotAdvisoriesFor(snapshot, name, candidate);
	return candidateAdvisories.every(
		(advisory) => !pinnedAdvisories.includes(advisory),
	);
}

export interface EligibleVersion {
	readonly version: string;
	readonly parsed: SemVer;
	readonly publishedMs: number;
	readonly viaSecurityExemption: boolean;
}

interface EligibilityInput {
	readonly snapshot: RegistrySnapshot;
	readonly name: string;
	readonly params: DepLagParams;
	readonly nowMs: number;
	readonly pinned: string | undefined;
	readonly pinnedParsed: SemVer | undefined;
	readonly satisfiesRuntime:
		| ((version: RegistryVersion) => boolean)
		| undefined;
}

function eligibleVersion(
	input: EligibilityInput,
	version: string,
): EligibleVersion | undefined {
	const parsed = parseNpmVersion(version);
	const detail = input.snapshot.packages[input.name]?.versions[version];
	if (parsed === undefined || detail === undefined) {
		return undefined;
	}
	// SPEC §4.8.3: prereleases, deprecations and yanked versions never
	// qualify; EC-12 and EC-14 close over these branches.
	if (
		parsed.prerelease !== undefined ||
		detail.deprecated === true ||
		detail.yanked === true
	) {
		return undefined;
	}
	const days = ageDays(detail.published, input.nowMs);
	if (days === undefined || days < 0) {
		return undefined;
	}
	if (snapshotAdvisoriesFor(input.snapshot, input.name, version).length > 0) {
		return undefined;
	}
	if (input.satisfiesRuntime !== undefined && !input.satisfiesRuntime(detail)) {
		return undefined;
	}
	if (days >= input.params.minReleaseAgeDays) {
		return {
			version,
			parsed,
			publishedMs: Date.parse(detail.published),
			viaSecurityExemption: false,
		};
	}
	const exempt =
		input.pinned !== undefined &&
		input.pinnedParsed !== undefined &&
		securityExempt(
			input.snapshot,
			input.name,
			input.pinned,
			input.pinnedParsed,
			version,
			parsed,
		);
	if (!exempt) {
		return undefined;
	}
	return {
		version,
		parsed,
		publishedMs: Date.parse(detail.published),
		viaSecurityExemption: true,
	};
}

export function eligibleStableVersions(
	snapshot: RegistrySnapshot,
	name: string,
	options: ResolveOptions = {},
): ReadonlyArray<EligibleVersion> {
	const nowMs = Date.parse(snapshot.fetchedAt);
	if (Number.isNaN(nowMs) || snapshot.packages[name] === undefined) {
		return [];
	}
	const entry: EligibilityInput = {
		snapshot,
		name,
		params: withDefaults(options.params),
		nowMs,
		pinned: options.pinned,
		pinnedParsed:
			options.pinned === undefined
				? undefined
				: parseNpmVersion(options.pinned),
		satisfiesRuntime: options.satisfiesRuntime,
	};
	const eligible: Array<EligibleVersion> = [];
	for (const version of Object.keys(
		snapshot.packages[name]?.versions ?? {},
	).sort()) {
		const candidate = eligibleVersion(entry, version);
		if (candidate !== undefined) {
			eligible.push(candidate);
		}
	}
	return eligible;
}

// SPEC §4.8.3: latest stable is the maximum of the eligible set. An empty
// eligible set is CDX-E401: no usable version in the snapshot.
export function selectLatestStable(
	snapshot: RegistrySnapshot,
	name: string,
	options: ResolveOptions = {},
): Result<EligibleVersion> {
	let best: EligibleVersion | undefined;
	for (const candidate of eligibleStableVersions(snapshot, name, options)) {
		if (
			best === undefined ||
			compareNpmVersions(candidate.parsed, best.parsed) > 0
		) {
			best = candidate;
		}
	}
	if (best === undefined) {
		return err(
			makeError(
				"CDX-E401",
				`no eligible stable version for ${name} in the registry snapshot`,
				"Refresh the registry snapshot; if the package is unpublished, replace or remove the dependency.",
			),
		);
	}
	return ok(best);
}

// SPEC §4.8.5: lag is now minus the moment the oldest newer eligible version
// became eligible (published plus minReleaseAgeDays).
export function lagDaysFor(
	snapshot: RegistrySnapshot,
	name: string,
	pinned: string,
	options: ResolveOptions = {},
): number | undefined {
	const params = withDefaults(options.params);
	const nowMs = Date.parse(snapshot.fetchedAt);
	if (Number.isNaN(nowMs)) {
		return undefined;
	}
	const pinnedParsed = parseNpmVersion(pinned);
	if (pinnedParsed === undefined) {
		return undefined;
	}
	let oldestEligibleMs: number | undefined;
	for (const candidate of eligibleStableVersions(snapshot, name, options)) {
		if (compareNpmVersions(candidate.parsed, pinnedParsed) <= 0) {
			continue;
		}
		const eligibleMs =
			candidate.publishedMs + params.minReleaseAgeDays * MS_PER_DAY;
		if (oldestEligibleMs === undefined || eligibleMs < oldestEligibleMs) {
			oldestEligibleMs = eligibleMs;
		}
	}
	if (oldestEligibleMs === undefined) {
		return 0;
	}
	return Math.max(0, (nowMs - oldestEligibleMs) / MS_PER_DAY);
}

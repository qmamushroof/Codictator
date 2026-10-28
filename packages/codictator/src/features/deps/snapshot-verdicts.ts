// The §4.8.5 verdicts that need registry data: vulnerability, deprecation,
// license and latest-stable lag for an exact pin. Anything the snapshot does
// not cover is skipped, never default-allowed.
import type { Finding } from "../engine/index.ts";
import type { EvalDep } from "./eval.ts";
import type { RegistrySnapshot } from "./index.ts";
import { classifyNpmRange, isUnversionedNpmSource } from "./npm.ts";
import {
	eligibleStableVersions,
	lagDaysFor,
	selectLatestStable,
	snapshotAdvisoriesFor,
} from "./selection.ts";
import type { DepLagParams } from "./stable.ts";
import { compareNpmVersions, parseNpmVersion } from "./stable.ts";

export interface PinnedCheckInput {
	readonly snapshot: RegistrySnapshot;
	readonly params: DepLagParams;
	readonly allow: ReadonlyArray<string>;
	readonly path: string;
	readonly dep: EvalDep;
	readonly unpublished: ReadonlyArray<string>;
}

function checkUnpublished(input: PinnedCheckInput): Finding | undefined {
	if (!input.unpublished.includes(input.dep.name)) {
		return undefined;
	}
	return {
		ruleId: "core/dep-no-deprecated",
		path: input.path,
		message: `${input.dep.name} is unpublished in the registry`,
		remediation: `Replace ${input.dep.name} with a maintained package.`,
	};
}

function checkDeprecated(
	snapshot: RegistrySnapshot,
	path: string,
	name: string,
	pinned: string,
): Finding | undefined {
	const detail = snapshot.packages[name]?.versions[pinned];
	if (detail?.deprecated !== true && detail?.yanked !== true) {
		return undefined;
	}
	return {
		ruleId: "core/dep-no-deprecated",
		path,
		message: `${name}@${pinned} in ${path} is deprecated or yanked`,
		remediation: `Replace ${name} with a maintained package.`,
	};
}

// SPEC §4.8.5: the remediation names the minimal fixed version and the
// latest stable; with no clean fix it says replace or remove (EC-3).
function checkVulnerable(
	input: PinnedCheckInput,
	pinned: string,
): Finding | undefined {
	const affecting = snapshotAdvisoriesFor(
		input.snapshot,
		input.dep.name,
		pinned,
	);
	if (affecting.length === 0) {
		return undefined;
	}
	const fixed = minimalFixedVersion(
		input.snapshot,
		input.dep.name,
		pinned,
		input.params,
	);
	const latest = selectLatestStable(input.snapshot, input.dep.name, {
		pinned,
		params: input.params,
	});
	const latestName = latest.ok ? latest.value.version : "unknown";
	return {
		ruleId: "core/dep-no-vulnerable",
		path: input.path,
		message: `${input.dep.name}@${pinned} in ${input.path} has ${String(affecting.length)} known advisories`,
		remediation:
			fixed === undefined
				? `Replace or remove ${input.dep.name}; latest stable is ${latestName}.`
				: `Upgrade ${input.dep.name} to ${fixed}; latest stable is ${latestName}.`,
	};
}

function checkLicense(
	snapshot: RegistrySnapshot,
	allow: ReadonlyArray<string>,
	path: string,
	name: string,
	pinned: string,
): Finding | undefined {
	const license = snapshot.packages[name]?.versions[pinned]?.license;
	if (license !== undefined && allow.includes(license)) {
		return undefined;
	}
	return {
		ruleId: "core/dep-license",
		path,
		message: `${name}@${pinned} in ${path} has license ${license ?? "unknown"}`,
		remediation: `Replace ${name} with an allowed-license package or tighten the policy.`,
	};
}

function checkPrerelease(
	path: string,
	name: string,
	pinned: string,
): Finding | undefined {
	if (parseNpmVersion(pinned)?.prerelease === undefined) {
		return undefined;
	}
	return {
		ruleId: "core/dep-latest-stable",
		path,
		message: `${name}@${pinned} in ${path} is a prerelease, never stable`,
		remediation: `Pin ${name} to a stable release.`,
	};
}

function checkStaleness(
	input: PinnedCheckInput,
	pinned: string,
	notes: Array<string>,
): Finding | undefined {
	const latest = selectLatestStable(input.snapshot, input.dep.name, {
		pinned,
		params: input.params,
	});
	if (!latest.ok || latest.value.version === pinned) {
		return undefined;
	}
	const pinnedParsed = parseNpmVersion(pinned);
	if (pinnedParsed === undefined) {
		return undefined;
	}
	const sameMajor = latest.value.parsed.major === pinnedParsed.major;
	const limit = sameMajor ? input.params.lagDays : input.params.majorLagDays;
	const lag = lagDaysFor(input.snapshot, input.dep.name, pinned, {
		pinned,
		params: input.params,
	});
	if ((lag ?? 0) <= limit) {
		const remaining = Math.max(0, Math.ceil(limit - (lag ?? 0)));
		notes.push(
			`${input.dep.name} in ${input.path} is ${String(Math.floor(lag ?? 0))} days behind ${latest.value.version}; blocks in ${String(remaining)} days`,
		);
		return undefined;
	}
	return {
		ruleId: "core/dep-latest-stable",
		path: input.path,
		message: `${input.dep.name}@${pinned} in ${input.path} lags latest stable ${latest.value.version} by ${String(Math.floor(lag ?? 0))} days`,
		remediation: `Upgrade ${input.dep.name} to a release newer than ${String(limit)} days.`,
	};
}

export function checkPinnedVerdicts(
	input: PinnedCheckInput,
	pinned: string,
	notes: Array<string>,
): ReadonlyArray<Finding> {
	const unpublished = checkUnpublished(input);
	if (unpublished !== undefined) {
		return [unpublished];
	}
	const findings: Array<Finding> = [];
	const deprecated = checkDeprecated(
		input.snapshot,
		input.path,
		input.dep.name,
		pinned,
	);
	if (deprecated !== undefined) {
		findings.push(deprecated);
	}
	const vulnerable = checkVulnerable(input, pinned);
	if (vulnerable !== undefined) {
		findings.push(vulnerable);
	}
	const license = checkLicense(
		input.snapshot,
		input.allow,
		input.path,
		input.dep.name,
		pinned,
	);
	if (license !== undefined) {
		findings.push(license);
	}
	const prerelease = checkPrerelease(input.path, input.dep.name, pinned);
	if (prerelease !== undefined) {
		return [...findings, prerelease];
	}
	const stale = checkStaleness(input, pinned, notes);
	if (stale !== undefined) {
		findings.push(stale);
	}
	return findings;
}

// The minimal S9-aware fix: the oldest same-major version free of the pinned
// version's advisories.
export function minimalFixedVersion(
	snapshot: RegistrySnapshot,
	name: string,
	pinned: string,
	params: DepLagParams,
): string | undefined {
	const pinnedParsed = parseNpmVersion(pinned);
	if (pinnedParsed === undefined) {
		return undefined;
	}
	const pinnedAdvisories = snapshotAdvisoriesFor(snapshot, name, pinned);
	let best: string | undefined;
	for (const candidate of eligibleStableVersions(snapshot, name, {
		pinned,
		params,
	})) {
		if (candidate.parsed.major !== pinnedParsed.major) {
			continue;
		}
		if (snapshotAdvisoriesFor(snapshot, name, candidate.version).length > 0) {
			continue;
		}
		if (pinnedAdvisories.length === 0) {
			return candidate.version;
		}
		const fixes = pinnedAdvisories.some(
			(advisory) =>
				!snapshotAdvisoriesFor(snapshot, name, candidate.version).includes(
					advisory,
				),
		);
		if (!fixes) {
			continue;
		}
		const bestParsed = best === undefined ? undefined : parseNpmVersion(best);
		if (
			bestParsed === undefined ||
			compareNpmVersions(candidate.parsed, bestParsed) < 0
		) {
			best = candidate.version;
		}
	}
	return best;
}

export function pinnedOrUnversionedNote(path: string, name: string): string {
	return `${name} in ${path} is an unversioned source; latest-stable skipped`;
}

// Exact pins (and prerelease exacts, judged as never-stable) run against the
// snapshot; unversioned sources skip latest-stable; ranges are exact-pin
// findings, never snapshot rows.
export function snapshotForm(
	range: string,
): "pinned" | "unversioned" | "ranged" {
	const form = classifyNpmRange(range);
	if (
		form === "exact" ||
		form === "alias-exact" ||
		form === "workspace-exact"
	) {
		return "pinned";
	}
	if (isUnversionedNpmSource(range)) {
		return "unversioned";
	}
	if (parseNpmVersion(range)?.prerelease !== undefined) {
		return "pinned";
	}
	return "ranged";
}

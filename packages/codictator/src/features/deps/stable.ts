// SPEC §6.1: version order for the npm ecosystem (numeric parts first,
// release beats prerelease, prerelease identifiers numeric then lexical).
// Latest-stable selection lives in selection.ts.

// SPEC §5.3: tunable defaults for core/dep-latest-stable.
export const DEFAULT_LAG_DAYS = 30;
export const DEFAULT_MAJOR_LAG_DAYS = 60;
export const DEFAULT_MIN_RELEASE_AGE_DAYS = 7;
export const MS_PER_DAY = 86_400_000;

export interface DepLagParams {
	readonly lagDays: number;
	readonly majorLagDays: number;
	readonly minReleaseAgeDays: number;
}

export const DEFAULT_DEP_LAG_PARAMS: DepLagParams = {
	lagDays: DEFAULT_LAG_DAYS,
	majorLagDays: DEFAULT_MAJOR_LAG_DAYS,
	minReleaseAgeDays: DEFAULT_MIN_RELEASE_AGE_DAYS,
};

export interface SemVer {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly prerelease: ReadonlyArray<string> | undefined;
}

// SPEC §6.1: an exact pin is a full x.y.z with an optional -pre suffix;
// compare follows npm version order (numeric parts first, release beats
// prerelease, prerelease identifiers numeric then lexical).
// The pattern lives at module scope so its quantifiers never count as
// branches of the function that applies it.
const NPM_VERSION_PATTERN =
	/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function versionPart(match: RegExpExecArray, index: number): number {
	return Number(match[index] ?? "");
}

function narrowVersionParts(
	match: RegExpExecArray,
): { major: number; minor: number; patch: number } | undefined {
	const major = versionPart(match, 1);
	const minor = versionPart(match, 2);
	const patch = versionPart(match, 3);
	if (
		!Number.isSafeInteger(major) ||
		!Number.isSafeInteger(minor) ||
		!Number.isSafeInteger(patch)
	) {
		return undefined;
	}
	return { major, minor, patch };
}

export function parseNpmVersion(value: string): SemVer | undefined {
	const match = NPM_VERSION_PATTERN.exec(value);
	if (match === null) {
		return undefined;
	}
	const parts = narrowVersionParts(match);
	if (parts === undefined) {
		return undefined;
	}
	const pre = match[4];
	if (pre === undefined || pre === "") {
		return { ...parts, prerelease: undefined };
	}
	return { ...parts, prerelease: pre.split(".") };
}

export function isNpmPrerelease(value: string): boolean {
	const parsed = parseNpmVersion(value);
	return parsed !== undefined && parsed.prerelease !== undefined;
}

function compareIdentifiers(left: string, right: string): -1 | 0 | 1 {
	const leftNumeric = /^\d+$/.test(left);
	const rightNumeric = /^\d+$/.test(right);
	if (leftNumeric && rightNumeric) {
		const leftNumber = Number(left);
		const rightNumber = Number(right);
		if (leftNumber < rightNumber) {
			return -1;
		}
		if (leftNumber > rightNumber) {
			return 1;
		}
		return 0;
	}
	if (leftNumeric) {
		return -1;
	}
	if (rightNumeric) {
		return 1;
	}
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

function compareVersionCore(left: SemVer, right: SemVer): -1 | 0 | 1 {
	const pairs: ReadonlyArray<readonly [number, number]> = [
		[left.major, right.major],
		[left.minor, right.minor],
		[left.patch, right.patch],
	];
	for (const pair of pairs) {
		if (pair[0] < pair[1]) {
			return -1;
		}
		if (pair[0] > pair[1]) {
			return 1;
		}
	}
	return 0;
}

function prereleaseOrderAt(
	left: ReadonlyArray<string>,
	right: ReadonlyArray<string>,
	index: number,
): -1 | 0 | 1 | undefined {
	const leftId = left[index];
	const rightId = right[index];
	if (leftId === undefined) {
		return -1;
	}
	if (rightId === undefined) {
		return 1;
	}
	const order = compareIdentifiers(leftId, rightId);
	return order === 0 ? undefined : order;
}

function comparePrerelease(
	left: ReadonlyArray<string> | undefined,
	right: ReadonlyArray<string> | undefined,
): -1 | 0 | 1 {
	if (left === undefined) {
		return right === undefined ? 0 : 1;
	}
	if (right === undefined) {
		return -1;
	}
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const order = prereleaseOrderAt(left, right, index);
		if (order !== undefined) {
			return order;
		}
	}
	return 0;
}

export function compareNpmVersions(left: SemVer, right: SemVer): -1 | 0 | 1 {
	const core = compareVersionCore(left, right);
	if (core !== 0) {
		return core;
	}
	return comparePrerelease(left.prerelease, right.prerelease);
}

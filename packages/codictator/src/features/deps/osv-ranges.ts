// OSV affected-range semantics: a range hits the versions between introduced
// (inclusive) and fixed (exclusive), or at/below last_affected when no fix is
// recorded. Withdrawing an advisory removes it from querybatch (EC-11).
import { field, isJsonRecord, stringField } from "./fields.ts";
import { compareNpmVersions, parseNpmVersion } from "./stable.ts";

export interface OsvEvent {
	readonly introduced: string;
	readonly fixed: string | undefined;
	readonly lastAffected: string | undefined;
}

export interface OsvRange {
	readonly type: string;
	readonly events: ReadonlyArray<OsvEvent>;
}

function narrowEvents(value: unknown): ReadonlyArray<OsvEvent> {
	if (!Array.isArray(value)) {
		return [];
	}
	const events: Array<OsvEvent> = [];
	for (const entry of value) {
		if (!isJsonRecord(entry)) {
			continue;
		}
		events.push({
			introduced: stringField(entry, "introduced") ?? "0",
			fixed: stringField(entry, "fixed"),
			lastAffected: stringField(entry, "last_affected"),
		});
	}
	return events;
}

export function narrowOsvRanges(value: unknown): ReadonlyArray<OsvRange> {
	if (!isJsonRecord(value)) {
		return [];
	}
	const affected = field(value, "affected");
	if (!Array.isArray(affected)) {
		return [];
	}
	const ranges: Array<OsvRange> = [];
	for (const entry of affected) {
		if (!isJsonRecord(entry)) {
			continue;
		}
		const list = field(entry, "ranges");
		if (!Array.isArray(list)) {
			continue;
		}
		for (const range of list) {
			if (!isJsonRecord(range)) {
				continue;
			}
			ranges.push({
				type: stringField(range, "type") ?? "",
				events: narrowEvents(field(range, "events")),
			});
		}
	}
	return ranges;
}

export function osvRangeAffectsVersion(
	range: OsvRange,
	version: string,
): boolean {
	const parsed = parseNpmVersion(version);
	if (parsed === undefined) {
		return false;
	}
	for (const event of range.events) {
		const introduced = parseNpmVersion(event.introduced);
		if (
			introduced !== undefined &&
			compareNpmVersions(parsed, introduced) < 0
		) {
			continue;
		}
		if (event.fixed !== undefined) {
			const fixed = parseNpmVersion(event.fixed);
			if (fixed !== undefined && compareNpmVersions(parsed, fixed) < 0) {
				return true;
			}
			continue;
		}
		if (event.lastAffected !== undefined) {
			const last = parseNpmVersion(event.lastAffected);
			if (last !== undefined && compareNpmVersions(parsed, last) <= 0) {
				return true;
			}
			continue;
		}
		return true;
	}
	return false;
}

export function osvAdvisoryAffects(
	ranges: ReadonlyArray<OsvRange>,
	version: string,
): boolean {
	return ranges.some((range) => osvRangeAffectsVersion(range, version));
}

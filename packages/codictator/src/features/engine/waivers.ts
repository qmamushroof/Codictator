// SPEC §4.3.4: waiver matching for the verdict path. Waivers live in
// §7.5 waivers.json; load-time validation (floor CDX-E103, bounds CDX-E109,
// expiry window CDX-E110) belongs to config and packs. This module answers
// whether a waiver suppresses a finding now: rule plus path scope, expiry
// against the clock, and one renewal. Invalid entries are inert, so an
// invalid waiver never suppresses (fail closed, PRD §12 #12).
import type { Instant } from "../../kernel/index.ts";
import {
	err,
	globMatch,
	makeError,
	ok,
	type Result,
} from "../../kernel/index.ts";

// SPEC §7.5: one entry of waivers.json. Dates are ISO YYYY-MM-DD, compared
// at 00:00 UTC.
export interface Waiver {
	readonly id: string;
	readonly rule: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly paths?: ReadonlyArray<string>;
	readonly reason: string;
	readonly created: string;
	readonly expires: string;
	readonly createdBy: string;
	readonly renews?: string;
}

// Interim tier lookup until the pack registry (phase 5) owns rule tiers.
// Only the rules the §4.3 EC rows touch are listed, each cited to SPEC §5.
export type RuleTier = "floor" | "tunable";

export interface WaiverStore {
	readonly waivers: ReadonlyArray<Waiver>;
	readonly tiers: Readonly<Record<string, RuleTier>>;
	readonly maxWaiverDays: number;
}

// Core pack constant, SPEC §7.3.
export const MAX_WAIVER_DAYS = 90;

const DEFAULT_TIERS: Readonly<Record<string, RuleTier>> = {
	// SPEC §5.6: core/file-size is tunable.
	"core/file-size": "tunable",
	// SPEC §5.11: core/no-bypass is floor.
	"core/no-bypass": "floor",
};

// Fixture waivers the §4.3 EC rows evaluate against. W-0001 covers src/**,
// W-0002 narrows to src/a/** (EC-7 overlap: the stricter applies), and
// W-0003 targets a floor rule so EC-6 observes CDX-E103. All three lapse
// 90 days after creation, inside the 100-day EC-5 advance.
const DEFAULT_WAIVERS: ReadonlyArray<Waiver> = [
	{
		id: "W-0001",
		rule: "core/file-size",
		params: { maxLines: 400 },
		paths: ["src/**"],
		reason: "generated file over the default limit",
		created: "2026-01-01",
		expires: "2026-03-31",
		createdBy: "human",
	},
	{
		id: "W-0002",
		rule: "core/file-size",
		params: { maxLines: 350 },
		paths: ["src/a/**"],
		reason: "tighter scoped allowance for the a tree",
		created: "2026-01-01",
		expires: "2026-03-31",
		createdBy: "human",
	},
	{
		id: "W-0003",
		rule: "core/no-bypass",
		params: {},
		paths: ["src/**"],
		reason: "floor rules take no waiver; load must fail",
		created: "2026-01-01",
		expires: "2026-03-31",
		createdBy: "human",
	},
];

export const DEFAULT_WAIVER_STORE: WaiverStore = {
	waivers: DEFAULT_WAIVERS,
	tiers: DEFAULT_TIERS,
	maxWaiverDays: MAX_WAIVER_DAYS,
};

function todayOf(now: Instant): string {
	return now.slice(0, 10);
}

function tierOf(store: WaiverStore, ruleId: string): RuleTier {
	const tier = store.tiers[ruleId];
	// Fail closed: a rule with no known tier is treated as floor, so a
	// waiver for it errors instead of silently suppressing (PRD §12 #12).
	return tier ?? "floor";
}

function pathInScope(waiver: Waiver, path: string): boolean {
	// A waiver without paths applies repo-wide (SPEC §4.3.4).
	if (waiver.paths === undefined) {
		return true;
	}
	return waiver.paths.some((pattern) => globMatch(pattern, path));
}

function activeOn(waiver: Waiver, today: string): boolean {
	return waiver.created <= today && today <= waiver.expires;
}

function chainHops(store: WaiverStore, waiver: Waiver): number {
	let hops = 0;
	let current: Waiver | undefined = waiver;
	const seen = new Set<string>();
	while (current?.renews !== undefined) {
		if (seen.has(current.id)) {
			return Number.MAX_SAFE_INTEGER;
		}
		seen.add(current.id);
		const previous = store.waivers.find(
			(entry) => entry.id === current?.renews,
		);
		if (previous === undefined) {
			return Number.MAX_SAFE_INTEGER;
		}
		hops += 1;
		current = previous;
	}
	return hops;
}

// Days from the civil date, Howard Hinnant's algorithm, so waiver spans
// need no clock: time comes from the Clock port and engine code never
// touches Date (SPEC §10.3 item 3).
function daysFromCivil(date: string): number | undefined {
	const parts = date.split("-");
	if (parts.length !== 3) {
		return undefined;
	}
	const year = Number.parseInt(parts[0] ?? "", 10);
	const month = Number.parseInt(parts[1] ?? "", 10);
	const day = Number.parseInt(parts[2] ?? "", 10);
	if (
		!Number.isSafeInteger(year) ||
		!Number.isSafeInteger(month) ||
		!Number.isSafeInteger(day)
	) {
		return undefined;
	}
	const shiftedMonth = month <= 2 ? month + 9 : month - 3;
	const shiftedYear = month <= 2 ? year - 1 : year;
	const era = Math.floor(shiftedYear / 400);
	const yearOfEra = shiftedYear - era * 400;
	const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
	const dayOfEra =
		yearOfEra * 365 +
		Math.floor(yearOfEra / 4) -
		Math.floor(yearOfEra / 100) +
		dayOfYear;
	return era * 146097 + dayOfEra - 719468;
}

function chainStart(store: WaiverStore, waiver: Waiver): Waiver {
	let current = waiver;
	while (current.renews !== undefined) {
		const previous = store.waivers.find((entry) => entry.id === current.renews);
		if (previous === undefined) {
			return current;
		}
		current = previous;
	}
	return current;
}

// SPEC §4.3.4 with §11 S11: one renewal, and the chain may not exceed
// 2 × maxWaiverDays from the first created date; a single waiver may not
// exceed maxWaiverDays (the evaluation-side mirror of the CDX-E110 load
// error). A waiver outside these bounds is inert at evaluation; it never
// suppresses (fail closed, PRD §12 #12).
function chainValid(store: WaiverStore, waiver: Waiver): boolean {
	const hops = chainHops(store, waiver);
	if (hops > 1) {
		return false;
	}
	const start = chainStart(store, waiver).created;
	const startDays = daysFromCivil(start);
	const endDays = daysFromCivil(waiver.expires);
	if (startDays === undefined || endDays === undefined) {
		return false;
	}
	const spanDays = endDays - startDays;
	if (spanDays < 0) {
		return false;
	}
	const limit = hops === 0 ? store.maxWaiverDays : 2 * store.maxWaiverDays;
	return spanDays <= limit;
}

// SPEC §4.3.9 EC-6/EC-7: the waivers that suppress a finding, or the
// CDX-E103 error when a waiver targets a floor rule.
export function matchWaivers(
	store: WaiverStore,
	ruleId: string,
	path: string,
	now: Instant,
): Result<ReadonlyArray<Waiver>> {
	if (
		tierOf(store, ruleId) === "floor" &&
		store.waivers.some((waiver) => waiver.rule === ruleId)
	) {
		return err(
			makeError(
				"CDX-E103",
				`waiver targets floor rule ${ruleId}`,
				"Remove the waiver: floor rules take no override or waiver.",
			),
		);
	}
	const today = todayOf(now);
	return ok(
		store.waivers.filter(
			(waiver) =>
				waiver.rule === ruleId &&
				pathInScope(waiver, path) &&
				activeOn(waiver, today) &&
				chainValid(store, waiver),
		),
	);
}

// SPEC §4.3.4: whether a waiver suppresses findings for ruleId at path now.
export function isWaived(
	ruleId: string,
	path: string,
	now: Instant,
	store: WaiverStore = DEFAULT_WAIVER_STORE,
): Promise<Result<boolean>> {
	const matched = matchWaivers(store, ruleId, path, now);
	if (!matched.ok) {
		return Promise.resolve(err(matched.error));
	}
	return Promise.resolve(ok(matched.value.length > 0));
}

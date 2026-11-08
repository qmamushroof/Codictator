// SPEC §4.3.4: waiver matching for the verdict path. Waivers live in
// §7.5 waivers.json; load-time validation (floor CDX-E103, bounds CDX-E109,
// expiry window CDX-E110) belongs to config and packs. This module answers
// whether a waiver suppresses a finding now: rule plus path scope, expiry
// against the clock, and one renewal. Invalid entries are inert, so an
// invalid waiver never suppresses (fail closed, PRD §12 #12). Split with
// waiver-chain.ts (date and renewal math) and waiver-file.ts (disk read
// and entry shape); this module keeps the types, defaults and the
// suppression path.
import type { Finding, Instant } from "../../kernel/index.ts";
import {
	err,
	globMatch,
	makeError,
	ok,
	type Result,
} from "../../kernel/index.ts";
import { activeOn, chainValid, todayOf } from "./waiver-chain.ts";

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

// The disk read and entry shape live in waiver-file.ts; re-exported here
// so the barrel and the verdict path keep one import.
export { readWaiverFile } from "./waiver-file.ts";

// SPEC §4.2.1 step 4 + §4.3.3 step 3: the waivers in force now, before
// rule or path scoping. Date and renewal-chain expiry makes a waiver
// inert here, exactly as at suppression time.
export function activeWaivers(store: WaiverStore, now: Instant): Array<Waiver> {
	const today = todayOf(now);
	return store.waivers.filter(
		(waiver) => activeOn(waiver, today) && chainValid(store, waiver),
	);
}

function tierOf(store: WaiverStore, ruleId: string): RuleTier {
	const tier = store.tiers[ruleId];
	// Fail closed: a rule with no known tier is treated as floor, so a
	// waiver for it errors instead of silently suppressing (PRD §12 #12).
	return tier ?? "floor";
}

function pathInScope(waiver: Waiver, path: string): boolean {
	// A waiver without paths applies repo-wide (SPEC §4.3.4). The waive
	// CLI writes paths: [] when no --paths flag is given, so an empty
	// list means the same as an absent one.
	if (waiver.paths === undefined || waiver.paths.length === 0) {
		return true;
	}
	return waiver.paths.some((pattern) => globMatch(pattern, path));
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

// SPEC §4.3.4: suppress findings covered by an active waiver, recording
// the waiver ids. Synthetic fail-closed findings (CDX-E*) never suppress,
// and an invalid floor-rule waiver blocks loudly instead of suppressing.
export async function applyWaivers(
	findings: ReadonlyArray<Finding>,
	store: WaiverStore,
	now: Instant,
): Promise<{ kept: Array<Finding>; waiversApplied: Array<string> }> {
	const kept: Array<Finding> = [];
	const applied = new Set<string>();
	for (const finding of findings) {
		if (finding.code?.startsWith("CDX-E") === true) {
			kept.push(finding);
			continue;
		}
		const matched = matchWaivers(
			store,
			finding.ruleId,
			finding.path ?? "",
			now,
		);
		if (!matched.ok) {
			kept.push(finding);
			kept.push({
				ruleId: finding.ruleId,
				code: matched.error.code,
				message: matched.error.message,
				remediation: matched.error.remediation,
			});
			continue;
		}
		if (matched.value.length === 0) {
			kept.push(finding);
			continue;
		}
		for (const waiver of matched.value) {
			applied.add(waiver.id);
		}
	}
	return { kept, waiversApplied: [...applied].sort() };
}

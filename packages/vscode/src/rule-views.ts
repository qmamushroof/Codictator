// SPEC §4.20.2 PR4: the Active rules polish. A rule detail names its pack
// version (or "unknown" when the engine reports none), tier, statement,
// reason and effective params, so the view groups packs by tier and the
// tooltip explains the rule without opening the pack. Shaping lives here;
// views.ts keeps diagnostics, violations and L2 on save.
import type { EngineRequest } from "./engine-client.ts";
import {
	arrayFieldOf,
	engineRequestFor,
	fieldOf,
	isRecord,
	stringFieldOf,
} from "./engine-client.ts";

export interface RuleDetail {
	readonly id: string;
	readonly pack: string;
	readonly version: string;
	readonly tier: string;
	readonly statement: string;
	readonly reason: string;
	readonly paramsText: string;
	readonly waiverExpiries: ReadonlyArray<string>;
	readonly coverage: string;
}

export interface RulePackGroup {
	readonly pack: string;
	readonly version: string;
	readonly rules: ReadonlyArray<RuleDetail>;
}

export interface RuleTierGroup {
	readonly tier: string;
	readonly packs: ReadonlyArray<RulePackGroup>;
}

function paramsTextOf(entry: Record<string, unknown>): string {
	const params = fieldOf(entry, "params");
	if (!isRecord(params)) {
		return "";
	}
	const rendered: Array<string> = [];
	for (const key of Object.keys(params).sort()) {
		rendered.push(`${key}=${String(params[key])}`);
	}
	return rendered.join(", ");
}

function waiverExpiriesOf(entry: Record<string, unknown>): Array<string> {
	const expiries: Array<string> = [];
	const waivers = fieldOf(entry, "waivers");
	if (!Array.isArray(waivers)) {
		return expiries;
	}
	for (const waiver of waivers) {
		if (!isRecord(waiver)) {
			continue;
		}
		const expiresAt = stringFieldOf(waiver, "expiresAt");
		if (expiresAt !== undefined) {
			expiries.push(expiresAt);
		}
	}
	return expiries;
}

function toRuleDetail(entry: Record<string, unknown>): RuleDetail | undefined {
	const id = stringFieldOf(entry, "id");
	if (id === undefined || id === "") {
		return undefined;
	}
	return {
		coverage: stringFieldOf(entry, "coverage") ?? "",
		id,
		pack: stringFieldOf(entry, "pack") ?? "unknown",
		paramsText: paramsTextOf(entry),
		reason: stringFieldOf(entry, "reason") ?? "",
		statement: stringFieldOf(entry, "statement") ?? "",
		tier: stringFieldOf(entry, "tier") ?? "unspecified",
		version:
			stringFieldOf(entry, "version") ??
			stringFieldOf(entry, "packVersion") ??
			"unknown",
		waiverExpiries: waiverExpiriesOf(entry),
	};
}

// SPEC §4.20.2 PR4: every rule across folders with its pack version,
// statement, reason and effective params.
export async function listRuleDetails(
	folders: ReadonlyArray<string>,
	request?: EngineRequest,
): Promise<Array<RuleDetail>> {
	const client = engineRequestFor(request);
	const details: Array<RuleDetail> = [];
	for (const folderPath of [...folders].sort()) {
		const answer = await client(folderPath, "rules/list", {});
		for (const entry of arrayFieldOf(answer, "rules")) {
			if (!isRecord(entry)) {
				continue;
			}
			const detail = toRuleDetail(entry);
			if (detail !== undefined) {
				details.push(detail);
			}
		}
	}
	return details;
}

// One tier's packs, sorted, with the first known rule version per pack.
function packGroupsOf(
	packs: ReadonlyMap<string, Array<RuleDetail>>,
): Array<RulePackGroup> {
	const packGroups: Array<RulePackGroup> = [];
	for (const pack of [...packs.keys()].sort()) {
		const rules = [...(packs.get(pack) ?? [])].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		);
		const version =
			rules.find((rule) => rule.version !== "unknown")?.version ?? "unknown";
		packGroups.push({ pack, rules, version });
	}
	return packGroups;
}

// SPEC §4.20.2 PR4: tier → pack → rules, each sorted, so the view reads top
// down. A pack takes the first known version its rules report.
export function groupRulesByTier(
	details: ReadonlyArray<RuleDetail>,
): Array<RuleTierGroup> {
	const tiers = new Map<string, Map<string, Array<RuleDetail>>>();
	for (const detail of details) {
		let packs = tiers.get(detail.tier);
		if (packs === undefined) {
			packs = new Map();
			tiers.set(detail.tier, packs);
		}
		const listed = packs.get(detail.pack) ?? [];
		listed.push(detail);
		packs.set(detail.pack, listed);
	}
	const groups: Array<RuleTierGroup> = [];
	for (const tier of [...tiers.keys()].sort()) {
		const packs = tiers.get(tier) ?? new Map();
		groups.push({ packs: packGroupsOf(packs), tier });
	}
	return groups;
}

// SPEC §4.20.2 PR4: the rule tooltip — statement, reason, effective params
// and waiver days left from the explicit clock, never a wall-clock read.
export function ruleTooltip(detail: RuleDetail, nowMs: number): string {
	const lines = [detail.statement, detail.reason].filter((line) => line !== "");
	if (detail.paramsText !== "") {
		lines.push(`params: ${detail.paramsText}`);
	}
	if (detail.coverage !== "") {
		lines.push(`coverage: ${detail.coverage}`);
	}
	if (detail.waiverExpiries.length > 0) {
		const days = detail.waiverExpiries.map((expiry) =>
			Math.max(0, Math.floor((Date.parse(expiry) - nowMs) / 86_400_000)),
		);
		const count =
			detail.waiverExpiries.length === 1
				? "1 waiver"
				: `${detail.waiverExpiries.length} waivers`;
		lines.push(`${count} (${Math.min(...days)} days left)`);
	}
	return lines.join("\n");
}

// SPEC §4.2.1 step 4: the effective rule parameters. Pack default, then
// config tunables (tightening only, validated at load), then active
// waivers (loosening within bound). Path-scoped waivers stay out of the
// overlay and ride suppression (§4.3.3 step 3) instead, so narrowing to
// path globs keeps its meaning.
import {
	activeWaivers,
	type Waiver,
	type WaiverStore,
} from "../features/engine/index.ts";
import type { Instant, PackManifest, PackRuleParam } from "../kernel/index.ts";

function loosenedNumber(
	spec: PackRuleParam,
	value: unknown,
): number | undefined {
	if (spec.type !== "integer" && spec.type !== "number") {
		return undefined;
	}
	if (
		typeof spec.default !== "number" ||
		!Number.isFinite(spec.default) ||
		typeof spec.bound !== "number" ||
		!Number.isFinite(spec.bound)
	) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	// SPEC §4.3.4: a waiver sets values between the pack default and the
	// bound; outside that window the waiver is inert here and stays loud
	// through core/waivers-valid.
	const low = Math.min(spec.default, spec.bound);
	const high = Math.max(spec.default, spec.bound);
	if (value < low || value > high) {
		return undefined;
	}
	return value;
}

// SPEC §4.3.9 EC-7: overlapping waivers for one rule resolve to the
// strictest value, the one closest to the pack default. Store order breaks
// ties, so the overlay is a pure function of the file bytes (§4.3.6).
function strictestPick(
	spec: PackRuleParam,
	candidates: ReadonlyArray<Waiver>,
	name: string,
): number | undefined {
	let best: number | undefined;
	if (typeof spec.default !== "number" || !Number.isFinite(spec.default)) {
		return undefined;
	}
	for (const waiver of candidates) {
		const value = loosenedNumber(spec, waiver.params[name]);
		if (value === undefined) {
			continue;
		}
		if (
			best === undefined ||
			Math.abs(value - spec.default) < Math.abs(best - spec.default)
		) {
			best = value;
		}
	}
	return best;
}

// SPEC §4.2.1 step 4: the manifest with active path-less waivers applied to
// tunable rule params. Floor rules never loosen (fail closed, §4.3.4); the
// input manifest is never mutated, so resolution stays deterministic.
export function applyWaiverParams(
	manifest: PackManifest,
	store: WaiverStore,
	now: Instant,
): PackManifest {
	const active = activeWaivers(store, now).filter(
		(waiver) => waiver.paths === undefined || waiver.paths.length === 0,
	);
	if (active.length === 0) {
		return manifest;
	}
	const byRule = new Map<string, Array<Waiver>>();
	for (const waiver of active) {
		const listed = byRule.get(waiver.rule);
		if (listed === undefined) {
			byRule.set(waiver.rule, [waiver]);
		} else {
			listed.push(waiver);
		}
	}
	let changed = false;
	const rules = manifest.rules.map((rule) => {
		const candidates = byRule.get(rule.id);
		if (candidates === undefined || rule.tier === "floor") {
			return rule;
		}
		const params = { ...rule.params };
		let ruleChanged = false;
		for (const [name, spec] of Object.entries(rule.params)) {
			const picked = strictestPick(spec, candidates, name);
			if (picked === undefined || picked === spec.default) {
				continue;
			}
			params[name] = { ...spec, default: picked };
			ruleChanged = true;
		}
		if (!ruleChanged) {
			return rule;
		}
		changed = true;
		return { ...rule, params };
	});
	return changed ? { ...manifest, rules } : manifest;
}

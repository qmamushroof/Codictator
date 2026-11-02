// SPEC §4.2.2: tunable tightening checks. Any loosening past the pack
// default is CDX-E104; floor rules (§5) have no override (CDX-E103).

import type { ParamSpec } from "./pack-data.ts";
import { FLOOR_RULES, TUNABLE_PARAMS } from "./pack-data.ts";
import { e101Invalid, fail, field, isRecord } from "./validate-shared.ts";

function checkTunablesShape(
	ruleId: string,
	raw: unknown,
): Record<string, unknown> {
	if (!isRecord(raw)) {
		e101Invalid(`#/tunables/${ruleId}`, "an object of parameters");
	}
	// The red suite pins { params: { ... } }; SPEC §7.2 shows the params
	// inline. Both normalize to the parameter map before per-param checks.
	const params = field(raw, "params");
	if (params !== undefined) {
		if (!isRecord(params)) {
			e101Invalid(`#/tunables/${ruleId}/params`, "an object of parameters");
		}
		return params;
	}
	return raw;
}

function checkNumericParam(
	ruleId: string,
	name: string,
	spec: {
		readonly default: number;
		readonly bound: number;
		readonly stricter: "lower" | "higher";
	},
	value: unknown,
): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		e101Invalid(
			`#/tunables/${ruleId}/${name}`,
			"a finite number at or above zero",
		);
	}
	const looser =
		spec.stricter === "lower" ? value > spec.default : value < spec.default;
	if (looser) {
		fail(
			"CDX-E104",
			`tunable ${ruleId} ${name}=${value} is looser than the pack default ${spec.default}`,
			`Move the loosening into .codictator/waivers.json (bound ${spec.bound}), or tighten ${name} to ${spec.default} or stricter.`,
		);
	}
}

function checkSetParam(
	ruleId: string,
	name: string,
	spec: {
		readonly default: ReadonlyArray<string>;
		readonly stricter: "subset" | "superset";
	},
	value: unknown,
): void {
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		e101Invalid(`#/tunables/${ruleId}/${name}`, "an array of strings");
	}
	const values: ReadonlyArray<string> = value;
	const looser =
		spec.stricter === "subset"
			? values.some((entry) => !spec.default.includes(entry))
			: spec.default.some((entry) => !values.includes(entry));
	if (looser) {
		fail(
			"CDX-E104",
			`tunable ${ruleId} ${name} is looser than the pack default`,
			"Move the loosening into .codictator/waivers.json, or tighten the list back toward the default.",
		);
	}
}

function checkParamValue(
	ruleId: string,
	name: string,
	spec: ParamSpec,
	value: unknown,
): void {
	if (spec.kind === "policy") {
		return;
	}
	if (spec.kind === "set") {
		checkSetParam(ruleId, name, spec, value);
		return;
	}
	checkNumericParam(ruleId, name, spec, value);
}

function rulePackId(ruleId: string): string {
	const slash = ruleId.indexOf("/");
	return slash < 0 ? ruleId : ruleId.slice(0, slash);
}

function isParamSpec(value: unknown): value is ParamSpec {
	if (!isRecord(value) || typeof field(value, "kind") !== "string") {
		return false;
	}
	return (
		field(value, "kind") === "number" ||
		field(value, "kind") === "set" ||
		field(value, "kind") === "policy"
	);
}

export function validateTunables(
	raw: unknown,
	packIds: ReadonlySet<string>,
): void {
	if (!isRecord(raw)) {
		e101Invalid("#/tunables", "an object keyed by rule id");
	}
	for (const ruleId of Object.keys(raw)) {
		const packId = rulePackId(ruleId);
		if (!packIds.has(packId)) {
			fail(
				"CDX-E101",
				`tunable rule "${ruleId}" needs pack "${packId}", which config.packs does not load`,
				`Add "${packId}" to config.packs or remove the tunable.`,
			);
		}
		if (FLOOR_RULES.has(ruleId)) {
			fail(
				"CDX-E103",
				`floor rule ${ruleId} has no override`,
				"Remove it from tunables; floor rules cannot be loosened or waived.",
			);
		}
		const spec = TUNABLE_PARAMS[ruleId];
		if (spec === undefined) {
			fail(
				"CDX-E101",
				`unknown tunable rule "${ruleId}"`,
				"Use a rule id from a loaded pack, then retry.",
			);
		}
		const params = checkTunablesShape(ruleId, field(raw, ruleId));
		for (const name of Object.keys(params)) {
			const param = field(spec, name);
			if (!isParamSpec(param)) {
				e101Invalid(
					`#/tunables/${ruleId}/${name}`,
					"a parameter the rule declares",
				);
			}
			checkParamValue(ruleId, name, param, field(params, name));
		}
	}
}

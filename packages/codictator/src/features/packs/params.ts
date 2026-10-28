// SPEC §4.4.4: tunable params carry default within bound along a stricter
// direction. The loader stores params opaquely, so malformed entries fail
// here (CDX-E216), not at load.
import { err, makeError, ok, type Result } from "../../kernel/index.ts";
import { field, isRecord } from "./manifest.ts";

function paramError(
	ruleId: string,
	name: string,
	detail: string,
): Result<never> {
	return err(
		makeError(
			"CDX-E216",
			`rule "${ruleId}" param "${name}" ${detail}`,
			"Keep every tunable default within its bound along the stricter direction, then re-run the self-test.",
		),
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function checkNumeric(
	ruleId: string,
	name: string,
	integer: boolean,
	def: unknown,
	bound: unknown,
	stricter: string,
	rest: Record<string, unknown>,
): Result<void> {
	const defOk = integer ? Number.isInteger(def) : isFiniteNumber(def);
	const boundOk = integer ? Number.isInteger(bound) : isFiniteNumber(bound);
	if (!defOk || !boundOk) {
		return paramError(
			ruleId,
			name,
			`needs numeric default and bound, got ${typeof def} and ${typeof bound}`,
		);
	}
	const defValue = def as number;
	const boundValue = bound as number;
	for (const edge of ["min", "max"]) {
		const limit = field(rest, edge);
		const limitOk =
			limit === undefined ||
			(integer ? Number.isInteger(limit) : isFiniteNumber(limit));
		if (!limitOk) {
			return paramError(ruleId, name, `carries a non-numeric ${edge}`);
		}
	}
	const min = field(rest, "min");
	const max = field(rest, "max");
	if (typeof min === "number" && defValue < min) {
		return paramError(ruleId, name, "sets a default below min");
	}
	if (typeof max === "number" && defValue > max) {
		return paramError(ruleId, name, "sets a default above max");
	}
	if (stricter === "lower" && defValue > boundValue) {
		return paramError(ruleId, name, "sets a default looser than bound");
	}
	if (stricter === "higher" && defValue < boundValue) {
		return paramError(ruleId, name, "sets a default looser than bound");
	}
	return ok(undefined);
}

function checkStringList(
	ruleId: string,
	name: string,
	def: unknown,
	bound: unknown,
	stricter: string,
): Result<void> {
	if (!Array.isArray(def) || !def.every((entry) => typeof entry === "string")) {
		return paramError(ruleId, name, "needs a string[] default");
	}
	if (
		!Array.isArray(bound) ||
		!bound.every((entry) => typeof entry === "string")
	) {
		return paramError(ruleId, name, "needs a string[] bound");
	}
	if (stricter === "subset") {
		for (const entry of def) {
			if (!bound.includes(entry)) {
				return paramError(
					ruleId,
					name,
					`sets a default ${entry} outside bound`,
				);
			}
		}
	}
	if (stricter === "superset") {
		for (const entry of bound) {
			if (!def.includes(entry)) {
				return paramError(
					ruleId,
					name,
					`sets a bound ${entry} outside default`,
				);
			}
		}
	}
	return ok(undefined);
}

// SPEC §4.4.4: every tunable param has default within bound and a stricter
// direction.
export function checkParam(
	ruleId: string,
	name: string,
	value: unknown,
): Result<void> {
	if (!isRecord(value)) {
		return paramError(ruleId, name, "must be a param object");
	}
	const type = field(value, "type");
	if (type !== "integer" && type !== "number" && type !== "string[]") {
		return paramError(
			ruleId,
			name,
			"needs a type of integer, number or string[]",
		);
	}
	const stricter = field(value, "stricter");
	if (
		stricter !== "lower" &&
		stricter !== "higher" &&
		stricter !== "subset" &&
		stricter !== "superset" &&
		stricter !== "policy"
	) {
		return paramError(ruleId, name, "needs a stricter direction");
	}
	if (type === "string[]") {
		return checkStringList(
			ruleId,
			name,
			field(value, "default"),
			field(value, "bound"),
			stricter,
		);
	}
	return checkNumeric(
		ruleId,
		name,
		type === "integer",
		field(value, "default"),
		field(value, "bound"),
		stricter,
		value,
	);
}

// SPEC §4.1.2: primitives for the JSON Schema 2020-12 subset validator.
// Keyword policy, JSON typing, diagnostics, $ref pointer resolution and the
// non-recursive scalar checks live here. Nothing here recurses into
// validateAgainst, so schema.ts can import this file without a cycle.
import { makeError } from "./errors.ts";
import { err, type Result } from "./result.ts";

export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
	"type",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const",
	"pattern",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"oneOf",
	"$ref",
	"$defs",
	"definitions",
]);

export const MAX_REF_DEPTH: number = 32;

export function isObjectRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// (tsconfig.base.json) satisfied without tripping useLiteralKeys.
export function field(schema: Record<string, unknown>, name: string): unknown {
	return schema[name];
}

export function jsonType(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "number";
	}
	return typeof value;
}

export function mismatch(
	path: string,
	expected: string,
	detail?: string,
): Result<void> {
	return err(
		makeError(
			"CDX-E101",
			`value at ${path} is invalid: expected ${expected}`,
			"Fix the value so it matches the schema, then retry.",
			detail,
		),
	);
}

export function unsupported(keyword: string): Result<void> {
	return err(
		makeError(
			"CDX-E201",
			`schema uses unsupported keyword "${keyword}"`,
			"Remove the keyword or teach the kernel validator about it (SPEC §4.1.2).",
		),
	);
}

export function resolvePointer(root: unknown, pointer: string): unknown {
	if (pointer === "#") {
		return root;
	}
	if (!pointer.startsWith("#/")) {
		return undefined;
	}
	let current: unknown = root;
	for (const raw of pointer.slice(2).split("/")) {
		const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		if (isObjectRecord(current)) {
			current = current[part];
		} else if (Array.isArray(current)) {
			const index = Number.parseInt(part, 10);
			current = Number.isSafeInteger(index) ? current[index] : undefined;
		} else {
			return undefined;
		}
		if (current === undefined) {
			return undefined;
		}
	}
	return current;
}

export function checkType(
	expected: unknown,
	value: unknown,
	path: string,
): Result<void> | undefined {
	if (typeof expected !== "string") {
		return unsupported("type");
	}
	const actual = jsonType(value);
	const matches =
		actual === expected || (expected === "number" && actual === "integer");
	if (!matches) {
		return mismatch(path, `type ${expected}`);
	}
	return undefined;
}

export function checkRange(
	schema: Record<string, unknown>,
	value: number,
	path: string,
): Result<void> | undefined {
	const minimum = field(schema, "minimum");
	if (typeof minimum === "number" && value < minimum) {
		return mismatch(path, `minimum ${minimum}`);
	}
	const maximum = field(schema, "maximum");
	if (typeof maximum === "number" && value > maximum) {
		return mismatch(path, `maximum ${maximum}`);
	}
	return undefined;
}

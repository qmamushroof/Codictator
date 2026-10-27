// SPEC §4.1.2: JSON Schema 2020-12 subset validator. Unsupported keywords
// in a schema are a load error (CDX-E201), never ignored (EC-10). Value
// mismatches fail with CDX-E101 naming the JSON-pointer path, never the
// value itself.
import { makeError } from "./errors.ts";
import { parseJson, stableStringify } from "./json.ts";
import { checkPattern } from "./pattern.ts";
import { err, ok, type Result } from "./result.ts";

const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
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

const MAX_REF_DEPTH = 32;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bracket access through a variable keeps noPropertyAccessFromIndexSignature
// (tsconfig.base.json) satisfied without tripping useLiteralKeys.
function field(schema: Record<string, unknown>, name: string): unknown {
	return schema[name];
}

function jsonType(value: unknown): string {
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

function mismatch(
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

function unsupported(keyword: string): Result<void> {
	return err(
		makeError(
			"CDX-E201",
			`schema uses unsupported keyword "${keyword}"`,
			"Remove the keyword or teach the kernel validator about it (SPEC §4.1.2).",
		),
	);
}

function resolvePointer(root: unknown, pointer: string): unknown {
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

function checkType(
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

function checkRange(
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

function checkString(
	schema: Record<string, unknown>,
	value: string,
	path: string,
): Result<void> | undefined {
	const minLength = field(schema, "minLength");
	if (typeof minLength === "number" && value.length < minLength) {
		return mismatch(path, `minLength ${minLength}`);
	}
	const maxLength = field(schema, "maxLength");
	if (typeof maxLength === "number" && value.length > maxLength) {
		return mismatch(path, `maxLength ${maxLength}`);
	}
	const pattern = field(schema, "pattern");
	if (typeof pattern === "string") {
		const safe = checkPattern(pattern);
		if (!safe.ok) {
			return err(safe.error);
		}
		let expression: RegExp;
		try {
			expression = new RegExp(pattern);
		} catch {
			return unsupported("pattern");
		}
		if (!expression.test(value)) {
			return mismatch(path, `pattern ${pattern}`);
		}
	}
	return undefined;
}

function checkArray(
	schema: Record<string, unknown>,
	root: unknown,
	value: Array<unknown>,
	path: string,
	depth: number,
): Result<void> | undefined {
	const minItems = field(schema, "minItems");
	if (typeof minItems === "number" && value.length < minItems) {
		return mismatch(path, `minItems ${minItems}`);
	}
	const maxItems = field(schema, "maxItems");
	if (typeof maxItems === "number" && value.length > maxItems) {
		return mismatch(path, `maxItems ${maxItems}`);
	}
	const items = field(schema, "items");
	if (items !== undefined) {
		if (Array.isArray(items)) {
			return unsupported("prefixItems");
		}
		for (let index = 0; index < value.length; index += 1) {
			const checked = validateAgainst(
				items,
				value[index],
				root,
				`${path}/${index}`,
				depth + 1,
			);
			if (!checked.ok) {
				return checked;
			}
		}
	}
	return undefined;
}

function checkObject(
	schema: Record<string, unknown>,
	root: unknown,
	value: Record<string, unknown>,
	path: string,
	depth: number,
): Result<void> | undefined {
	const required = field(schema, "required");
	if (Array.isArray(required)) {
		for (const name of required) {
			if (typeof name !== "string") {
				return unsupported("required");
			}
			if (value[name] === undefined) {
				return mismatch(path, `required property "${name}"`);
			}
		}
	}
	const properties = field(schema, "properties");
	if (isObjectRecord(properties)) {
		for (const key of Object.keys(properties)) {
			if (value[key] !== undefined) {
				const checked = validateAgainst(
					properties[key],
					value[key],
					root,
					`${path}/${key}`,
					depth + 1,
				);
				if (!checked.ok) {
					return checked;
				}
			}
		}
	}
	const additional = field(schema, "additionalProperties");
	const declared =
		properties !== undefined && isObjectRecord(properties)
			? new Set(Object.keys(properties))
			: new Set<string>();
	if (additional === false) {
		for (const key of Object.keys(value)) {
			if (!declared.has(key)) {
				return mismatch(path, `no additional property "${key}"`);
			}
		}
	} else if (additional !== undefined && additional !== true) {
		for (const key of Object.keys(value)) {
			if (!declared.has(key)) {
				const checked = validateAgainst(
					additional,
					value[key],
					root,
					`${path}/${key}`,
					depth + 1,
				);
				if (!checked.ok) {
					return checked;
				}
			}
		}
	}
	return undefined;
}

function validateAgainst(
	schema: unknown,
	value: unknown,
	root: unknown,
	path: string,
	depth: number,
): Result<void> {
	if (depth > MAX_REF_DEPTH) {
		return err(
			makeError(
				"CDX-E902",
				"schema $ref nesting exceeds the validator budget",
				"Flatten the schema so $ref chains stay shallow, then retry.",
			),
		);
	}
	if (typeof schema === "boolean") {
		return schema ? ok(undefined) : mismatch(path, "a value the schema allows");
	}
	if (!isObjectRecord(schema)) {
		return unsupported("$ref");
	}
	for (const keyword of Object.keys(schema)) {
		if (!SUPPORTED_KEYWORDS.has(keyword)) {
			return unsupported(keyword);
		}
	}
	const reference = field(schema, "$ref");
	if (typeof reference === "string") {
		const target = resolvePointer(root, reference);
		if (target === undefined) {
			return unsupported("$ref");
		}
		const resolved = validateAgainst(target, value, root, path, depth + 1);
		if (!resolved.ok) {
			return resolved;
		}
	}
	const enumeration = field(schema, "enum");
	if (Array.isArray(enumeration)) {
		const wanted = stableStringify(value);
		const found = enumeration.some(
			(candidate) => stableStringify(candidate) === wanted,
		);
		if (!found) {
			return mismatch(path, "one of the enum values");
		}
	}
	if ("const" in schema) {
		if (stableStringify(field(schema, "const")) !== stableStringify(value)) {
			return mismatch(path, "the const value");
		}
	}
	const expectedType = field(schema, "type");
	if (expectedType !== undefined) {
		const checked = checkType(expectedType, value, path);
		if (checked !== undefined) {
			return checked;
		}
	}
	if (typeof value === "number") {
		const checked = checkRange(schema, value, path);
		if (checked !== undefined) {
			return checked;
		}
	}
	if (typeof value === "string") {
		const checked = checkString(schema, value, path);
		if (checked !== undefined) {
			return checked;
		}
	}
	if (Array.isArray(value)) {
		const checked = checkArray(schema, root, value, path, depth);
		if (checked !== undefined) {
			return checked;
		}
	}
	if (isObjectRecord(value)) {
		const checked = checkObject(schema, root, value, path, depth);
		if (checked !== undefined) {
			return checked;
		}
	}
	const branches = field(schema, "oneOf");
	if (Array.isArray(branches)) {
		let matches = 0;
		let firstFailure: Result<void> | undefined;
		for (const branch of branches) {
			const checked = validateAgainst(branch, value, root, path, depth + 1);
			if (checked.ok) {
				matches += 1;
			} else if (firstFailure === undefined) {
				firstFailure = checked;
			}
		}
		if (matches !== 1) {
			return firstFailure ?? mismatch(path, "exactly one oneOf branch");
		}
	}
	return ok(undefined);
}

export function validateSchema(
	schemaText: string,
	value: unknown,
): Result<void> {
	const parsed = parseJson(schemaText);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	return validateAgainst(parsed.value, value, parsed.value, "#", 0);
}

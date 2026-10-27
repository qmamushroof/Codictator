// SPEC §4.1.2: the only JSON.parse call in the codebase. Malformed input
// is a Result error naming line and column, never a throw (EC-9). Generated
// files go through stableStringify so regeneration is byte-identical (EC-7).
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

function errorPosition(error: unknown): number | undefined {
	if (error instanceof SyntaxError) {
		const match = /at position (\d+)/.exec(error.message);
		const raw = match?.[1];
		if (raw !== undefined) {
			const parsed = Number.parseInt(raw, 10);
			if (Number.isSafeInteger(parsed)) {
				return parsed;
			}
		}
	}
	return undefined;
}

function offsetToLineColumn(
	text: string,
	offset: number,
): { readonly line: number; readonly column: number } {
	const clamped = Math.max(0, Math.min(offset, text.length));
	let line = 1;
	let column = 1;
	for (let index = 0; index < clamped; index += 1) {
		if (text.charAt(index) === "\n") {
			line += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	return { line, column };
}

export function parseJson(text: string): Result<unknown> {
	try {
		return ok<unknown>(JSON.parse(text));
	} catch (error) {
		const at = errorPosition(error) ?? text.length;
		const location = offsetToLineColumn(text, at);
		return err(
			makeError(
				"CDX-E101",
				`invalid JSON at line ${location.line}, column ${location.column}`,
				"Fix the JSON syntax at the reported line and column, then retry.",
			),
		);
	}
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortedJson);
	}
	if (isJsonObject(value)) {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortedJson(value[key]);
		}
		return sorted;
	}
	return value;
}

export function stableStringify(value: unknown): string {
	return `${JSON.stringify(sortedJson(value), undefined, 2)}\n`;
}

// SPEC §4.18.1: the event log needs canonical single-line JSON (one object
// per line), while generated files use the pretty stableStringify (§4.1.2).
// Keys sort identically, so both forms hash the same content.
export function stableLineStringify(value: unknown): string {
	return `${JSON.stringify(sortedJson(value))}\n`;
}

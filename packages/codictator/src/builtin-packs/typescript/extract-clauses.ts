// SPEC §4.11.3 + §6.1: clause parsers for the TypeScript import extractor.
// Covers ES `import`/`export … from`, dynamic `import()`, `require()` and
// `import x = require()`; type imports stay edges (§4.11 EC-4). Non-literal
// dynamic targets report `dynamic:expr` (§4.11 EC-5).
import { readStringLiteral, skipAtom, skipQuoted } from "./extract-literals.ts";
import { isWordChar, matchWordAt, skipTrivia } from "./extract-words.ts";

// The `from "spec"` tail of a static import or re-export; the search stays
// at brace depth zero so an imported name like `{ from }` never matches.
export function findFromSpecifier(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	let cursor = index;
	let depth = 0;
	while (cursor < text.length) {
		const skipped = skipTrivia(text, cursor);
		cursor = skipped === cursor ? skipAtom(text, cursor) : skipped;
		if (cursor >= text.length) {
			return undefined;
		}
		const char = text.charAt(cursor);
		if (char === "{" || char === "(" || char === "[") {
			depth += 1;
			cursor += 1;
			continue;
		}
		if (char === "}" || char === ")" || char === "]") {
			if (depth === 0) {
				return undefined;
			}
			depth -= 1;
			cursor += 1;
			continue;
		}
		if (char === ";" && depth === 0) {
			return undefined;
		}
		if (depth === 0 && matchWordAt(text, cursor, "from")) {
			const after = skipTrivia(text, cursor + 4);
			const literal = readStringLiteral(text, after);
			if (literal === undefined) {
				return undefined;
			}
			return { spec: literal.value, next: literal.next };
		}
		if (char === "'" || char === '"' || char === "`") {
			cursor = skipQuoted(text, cursor, char);
			continue;
		}
		cursor += 1;
	}
	return undefined;
}

function readIdentifier(text: string, index: number): number {
	let cursor = index;
	while (cursor < text.length && isWordChar(text.charAt(cursor))) {
		cursor += 1;
	}
	return cursor;
}

function parseDynamicImport(
	text: string,
	open: number,
): { readonly spec: string; readonly next: number } {
	const arg = skipTrivia(text, open + 1);
	const literal = readStringLiteral(text, arg);
	if (literal !== undefined) {
		const after = skipTrivia(text, literal.next);
		return {
			spec: literal.value,
			next: text.charAt(after) === ")" ? after + 1 : literal.next,
		};
	}
	return { spec: "dynamic:expr", next: open + 1 };
}

function parseImportEquals(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	const nameEnd = readIdentifier(text, index);
	if (nameEnd === index) {
		return undefined;
	}
	const afterName = skipTrivia(text, nameEnd);
	if (text.charAt(afterName) !== "=") {
		return undefined;
	}
	const afterEquals = skipTrivia(text, afterName + 1);
	if (!matchWordAt(text, afterEquals, "require")) {
		return undefined;
	}
	const arg = skipTrivia(text, afterEquals + 7);
	if (text.charAt(arg) !== "(") {
		return undefined;
	}
	const literal = readStringLiteral(text, skipTrivia(text, arg + 1));
	if (literal === undefined) {
		return { spec: "dynamic:expr", next: arg + 1 };
	}
	const after = skipTrivia(text, literal.next);
	return {
		spec: literal.value,
		next: text.charAt(after) === ")" ? after + 1 : literal.next,
	};
}

export function parseImportAt(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	let cursor = skipTrivia(text, index + 6);
	if (text.charAt(cursor) === "(") {
		return parseDynamicImport(text, cursor);
	}
	if (matchWordAt(text, cursor, "type")) {
		cursor = skipTrivia(text, cursor + 4);
	}
	const literal = readStringLiteral(text, cursor);
	if (literal !== undefined) {
		return { spec: literal.value, next: literal.next };
	}
	const equals = parseImportEquals(text, cursor);
	if (equals !== undefined) {
		return equals;
	}
	return findFromSpecifier(text, cursor);
}

export function parseExportAt(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	let cursor = skipTrivia(text, index + 6);
	if (matchWordAt(text, cursor, "type")) {
		cursor = skipTrivia(text, cursor + 4);
	}
	return findFromSpecifier(text, cursor);
}

export function parseRequireAt(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	const open = skipTrivia(text, index + 7);
	if (text.charAt(open) !== "(") {
		return undefined;
	}
	return parseDynamicImport(text, open);
}

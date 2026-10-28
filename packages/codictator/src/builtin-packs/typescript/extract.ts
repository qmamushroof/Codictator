// SPEC §4.11.3 + §6.1: the TypeScript/JavaScript import extractor. A lexer,
// never the compiler API: the zero-deps rule for packages/codictator
// forbids the TypeScript compiler at runtime. Covers ES `import`/`export …
// from`, dynamic `import()`, `require()` and `import x = require()`; type
// imports stay edges (§4.11 EC-4) and strings/comments never yield edges
// (§4.11 EC-7). Non-literal dynamic targets report `dynamic:expr` (§4.11
// EC-5), which the arch checks judge as a stated limit.
import type { ImportExtractor, ImportRef } from "../../features/arch/index.ts";
import {
	lineAtIndex,
	lineStartsFor,
	TYPESCRIPT_SOURCE_EXTENSIONS,
	toPosixPath,
} from "./lex.ts";

function isWordChar(char: string): boolean {
	return (
		(char >= "A" && char <= "Z") ||
		(char >= "a" && char <= "z") ||
		(char >= "0" && char <= "9") ||
		char === "_" ||
		char === "$"
	);
}

// A keyword match needs boundaries on both sides, so `required` never reads
// as `require` and `important` never reads as `import`.
export function matchWordAt(
	text: string,
	index: number,
	word: string,
): boolean {
	if (!text.startsWith(word, index)) {
		return false;
	}
	const before = index === 0 ? "" : text.charAt(index - 1);
	const after = text.charAt(index + word.length);
	if (before !== "" && isWordChar(before)) {
		return false;
	}
	if (after !== "" && isWordChar(after)) {
		return false;
	}
	return true;
}

// Whitespace and comments end wherever a string or code token starts.
export function skipTrivia(text: string, index: number): number {
	let cursor = index;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		const next = text.charAt(cursor + 1);
		if (char === " " || char === "\t" || char === "\n" || char === "\r") {
			cursor += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (cursor < text.length && text.charAt(cursor) !== "\n") {
				cursor += 1;
			}
			continue;
		}
		if (char === "/" && next === "*") {
			cursor += 2;
			while (cursor < text.length) {
				if (text.charAt(cursor) === "*" && text.charAt(cursor + 1) === "/") {
					cursor += 2;
					break;
				}
				cursor += 1;
			}
			continue;
		}
		break;
	}
	return cursor;
}

// Skip a quoted region; template `${}` holes recurse through balanced code.
function skipBalanced(text: string, index: number): number {
	let cursor = index + 1;
	let depth = 1;
	while (cursor < text.length && depth > 0) {
		const nested = skipAtom(text, cursor);
		if (text.charAt(nested) === "{") {
			depth += 1;
		} else if (text.charAt(nested) === "}") {
			depth -= 1;
		}
		cursor = nested + 1;
	}
	return cursor;
}

function skipQuoted(text: string, index: number, quote: string): number {
	let cursor = index + 1;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\") {
			cursor += 2;
			continue;
		}
		if (quote === "`" && char === "$" && text.charAt(cursor + 1) === "{") {
			cursor = skipBalanced(text, cursor + 1);
			continue;
		}
		if (char === quote) {
			return cursor + 1;
		}
		cursor += 1;
	}
	return cursor;
}

function skipAtom(text: string, index: number): number {
	const char = text.charAt(index);
	const next = text.charAt(index + 1);
	if (char === "/" && next === "/") {
		let cursor = index;
		while (cursor < text.length && text.charAt(cursor) !== "\n") {
			cursor += 1;
		}
		return cursor;
	}
	if (char === "/" && next === "*") {
		let cursor = index + 2;
		while (cursor < text.length) {
			if (text.charAt(cursor) === "*" && text.charAt(cursor + 1) === "/") {
				return cursor + 2;
			}
			cursor += 1;
		}
		return cursor;
	}
	if (char === "'" || char === '"' || char === "`") {
		return skipQuoted(text, index, char);
	}
	return index;
}

// Reads a literal specifier; a template holding `${}` is not a literal, so
// the caller reports it unresolvable instead of inventing a target.
function readStringLiteral(
	text: string,
	index: number,
): { readonly value: string; readonly next: number } | undefined {
	const quote = text.charAt(index);
	if (quote !== "'" && quote !== '"' && quote !== "`") {
		return undefined;
	}
	let value = "";
	let cursor = index + 1;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\") {
			value += text.slice(cursor, cursor + 2);
			cursor += 2;
			continue;
		}
		if (quote === "`" && char === "$" && text.charAt(cursor + 1) === "{") {
			return undefined;
		}
		if (char === quote) {
			return { value, next: cursor + 1 };
		}
		if (char === "\n" && quote !== "`") {
			return undefined;
		}
		value += char;
		cursor += 1;
	}
	return undefined;
}

// The `from "spec"` tail of a static import or re-export; the search stays
// at brace depth zero so an imported name like `{ from }` never matches.
function findFromSpecifier(
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

function parseImportAt(
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

function parseExportAt(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	let cursor = skipTrivia(text, index + 6);
	if (matchWordAt(text, cursor, "type")) {
		cursor = skipTrivia(text, cursor + 4);
	}
	return findFromSpecifier(text, cursor);
}

function parseRequireAt(
	text: string,
	index: number,
): { readonly spec: string; readonly next: number } | undefined {
	const open = skipTrivia(text, index + 7);
	if (text.charAt(open) !== "(") {
		return undefined;
	}
	return parseDynamicImport(text, open);
}

// SPEC §4.11.3: lexes each source file in one pass; the scan order keeps
// the output deterministic without a later sort.
export function extractImports(
	fromPath: string,
	text: string,
): Array<ImportRef> {
	const from = toPosixPath(fromPath);
	const starts = lineStartsFor(text);
	const refs: Array<ImportRef> = [];
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		const next = text.charAt(index + 1);
		if (char === "/" && (next === "/" || next === "*")) {
			index = skipAtom(text, index);
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			index = skipAtom(text, index);
			continue;
		}
		if (matchWordAt(text, index, "import")) {
			const parsed = parseImportAt(text, index);
			if (parsed !== undefined) {
				refs.push({ from, to: parsed.spec, line: lineAtIndex(starts, index) });
				index = parsed.next;
				continue;
			}
		} else if (matchWordAt(text, index, "export")) {
			const parsed = parseExportAt(text, index);
			if (parsed !== undefined) {
				refs.push({ from, to: parsed.spec, line: lineAtIndex(starts, index) });
				index = parsed.next;
				continue;
			}
		} else if (matchWordAt(text, index, "require")) {
			const parsed = parseRequireAt(text, index);
			if (parsed !== undefined) {
				refs.push({ from, to: parsed.spec, line: lineAtIndex(starts, index) });
				index = parsed.next;
				continue;
			}
		}
		index += 1;
	}
	return refs;
}

// SPEC §3.4: the per-language extractor the arch graph consumes.
export function typescriptExtractor(): ImportExtractor {
	return {
		language: "typescript",
		extensions: [...TYPESCRIPT_SOURCE_EXTENSIONS],
		extract: (path: string, text: string): Array<ImportRef> =>
			extractImports(path, text),
	};
}

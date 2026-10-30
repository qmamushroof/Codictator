// SPEC §6.1: import/export specifier lexer. Word-boundary matching
// with comment, string and template-hole skipping, so specifiers inside
// strings, comments and fixture text never count. The packs module cannot
// import the pack supplies (§3.3), so this mirrors the §6.1 supply lexer.
import { isSpaceChar, readLiteral, skipQuoted } from "./health-lex.ts";

function isLexWordChar(code: number): boolean {
	return (
		(code >= 0x41 && code <= 0x5a) ||
		(code >= 0x61 && code <= 0x7a) ||
		(code >= 0x30 && code <= 0x39) ||
		code === 0x5f ||
		code === 0x24
	);
}

function wordAt(text: string, index: number, word: string): boolean {
	if (!text.startsWith(word, index)) {
		return false;
	}
	const before = index === 0 ? Number.NaN : text.charCodeAt(index - 1);
	if (!Number.isNaN(before) && isLexWordChar(before)) {
		return false;
	}
	const after = text.charCodeAt(index + word.length);
	return Number.isNaN(after) || !isLexWordChar(after);
}

function skipSpaceComments(text: string, index: number): number {
	let cursor = index;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (isSpaceChar(char)) {
			cursor += 1;
			continue;
		}
		if (char === "/" && text.charAt(cursor + 1) === "/") {
			while (cursor < text.length && text.charAt(cursor) !== "\n") {
				cursor += 1;
			}
			continue;
		}
		if (char === "/" && text.charAt(cursor + 1) === "*") {
			const close = text.indexOf("*/", cursor + 2);
			cursor = close < 0 ? text.length : close + 2;
			continue;
		}
		break;
	}
	return cursor;
}

export interface LiteralSpecifier {
	readonly spec: string;
	readonly line: number;
}

// SPEC §6.1: import and export specifiers read by a lexer, never a regex,
// so specifiers inside strings, comments and template holes never count.
// A non-literal dynamic target yields nothing; the caller treats it as
// unresolvable instead of inventing a target.
export function extractLiteralSpecifiers(
	text: string,
): Array<LiteralSpecifier> {
	const starts: Array<number> = [0];
	for (let at = 0; at < text.length; at += 1) {
		if (text.charAt(at) === "\n") {
			starts.push(at + 1);
		}
	}
	const lineOf = (at: number): number => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if ((starts[mid] ?? 0) <= at) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return low + 1;
	};
	const specs: Array<LiteralSpecifier> = [];
	const pushLiteral = (at: number): number => {
		const found = readLiteral(text, at);
		if (found !== undefined) {
			specs.push({ spec: found.value, line: lineOf(at) });
			return found.next;
		}
		return skipQuoted(text, at);
	};
	// One clause step: a string, `from` or `require` word either finishes
	// the clause (done) or advances past itself. Undefined means no word
	// matched and the brace scan continues.
	const clauseString = (
		cursor: number,
		depth: number,
		sideEffect: boolean,
	): { readonly next: number; readonly done: boolean } | undefined => {
		const char = text.charAt(cursor);
		if (char !== '"' && char !== "'" && char !== "`") {
			return undefined;
		}
		if (sideEffect && depth === 0) {
			return { next: pushLiteral(cursor), done: true };
		}
		return { next: skipQuoted(text, cursor), done: false };
	};
	const clauseFrom = (cursor: number, depth: number): number | undefined => {
		if (!wordAt(text, cursor, "from") || depth !== 0) {
			return undefined;
		}
		const after = skipSpaceComments(text, cursor + 4);
		const found = readLiteral(text, after);
		if (found !== undefined) {
			specs.push({ spec: found.value, line: lineOf(after) });
			return found.next;
		}
		return skipQuoted(text, after);
	};
	const clauseRequire = (cursor: number, depth: number): number | undefined => {
		if (!wordAt(text, cursor, "require") || depth !== 0) {
			return undefined;
		}
		const call = skipSpaceComments(text, cursor + 7);
		if (text.charAt(call) !== "(") {
			return undefined;
		}
		const literal = readLiteral(text, skipSpaceComments(text, call + 1));
		if (literal !== undefined) {
			specs.push({ spec: literal.value, line: lineOf(cursor) });
			return literal.next;
		}
		return call + 1;
	};
	// Brace and terminator scan for one clause position: advances past
	// the character, tracks depth, or stops the clause.
	const stepBrace = (
		cursor: number,
		depth: number,
	): {
		readonly cursor: number;
		readonly depth: number;
		readonly stop: boolean;
	} => {
		const char = text.charAt(cursor);
		if (char === "{") {
			return { cursor: cursor + 1, depth: depth + 1, stop: false };
		}
		if (char === "}") {
			return depth === 0
				? { cursor, depth, stop: true }
				: { cursor: cursor + 1, depth: depth - 1, stop: false };
		}
		if (
			char === ";" ||
			char === "(" ||
			char === ")" ||
			(char === "=" && text.charAt(cursor + 1) === ">")
		) {
			return { cursor, depth, stop: true };
		}
		return { cursor: cursor + 1, depth, stop: false };
	};
	// A static `import`/`export` clause: the `from` specifier when one
	// follows at brace depth zero, else the side-effect string for
	// `import` (bare `export {...}` names no module).
	const clause = (from: number, sideEffect: boolean): number => {
		let cursor = from;
		let depth = 0;
		let resume = from;
		while (cursor < text.length) {
			cursor = skipSpaceComments(text, cursor);
			if (cursor >= text.length) {
				break;
			}
			resume = cursor;
			const stepped = clauseString(cursor, depth, sideEffect);
			if (stepped !== undefined) {
				if (stepped.done) {
					return stepped.next;
				}
				cursor = stepped.next;
				continue;
			}
			const fromNext = clauseFrom(cursor, depth);
			if (fromNext !== undefined) {
				return fromNext;
			}
			const requireNext = clauseRequire(cursor, depth);
			if (requireNext !== undefined) {
				return requireNext;
			}
			const advanced = stepBrace(cursor, depth);
			cursor = advanced.cursor;
			depth = advanced.depth;
			if (advanced.stop) {
				break;
			}
		}
		return resume + 1;
	};
	const scanImportWord = (index: number, isImport: boolean): number => {
		const after = skipSpaceComments(text, index + (isImport ? 6 : 7));
		if (text.charAt(after) === "." && isImport) {
			return after + 1;
		}
		if (text.charAt(after) === "(") {
			const literal = readLiteral(text, skipSpaceComments(text, after + 1));
			if (literal !== undefined) {
				specs.push({ spec: literal.value, line: lineOf(after + 1) });
				return literal.next;
			}
			return after + 1;
		}
		return clause(after, isImport);
	};
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === '"' || char === "'" || char === "`") {
			index = skipQuoted(text, index);
			continue;
		}
		if (char === "/" && text.charAt(index + 1) === "/") {
			while (index < text.length && text.charAt(index) !== "\n") {
				index += 1;
			}
			continue;
		}
		if (char === "/" && text.charAt(index + 1) === "*") {
			const close = text.indexOf("*/", index + 2);
			index = close < 0 ? text.length : close + 2;
			continue;
		}
		const isImport = char === "i" && wordAt(text, index, "import");
		const isRequire = char === "r" && wordAt(text, index, "require");
		if (isImport || isRequire) {
			index = scanImportWord(index, isImport);
			continue;
		}
		if (char === "e" && wordAt(text, index, "export")) {
			index = clause(skipSpaceComments(text, index + 6), false);
			continue;
		}
		index += 1;
	}
	return specs;
}

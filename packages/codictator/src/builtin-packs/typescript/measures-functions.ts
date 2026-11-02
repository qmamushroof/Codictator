// SPEC §6.1 measures: function size by brace matching from `function`,
// method and arrow-body starts; cyclomatic as 1 plus the branch tokens.
import { skipTrivia } from "./extract-words.ts";
import { blankCode, lineAtIndex, lineStartsFor } from "./lex.ts";

export interface FunctionSpan {
	readonly line: number;
	readonly lines: number;
}

// SPEC §6.1: 1 + `if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`
// and the ternary `?`. The ternary excludes `?.`, `??` and `?:` (optional
// members), so an optional parameter never counts as a branch.
// Patterns live at module scope so the branch words they name never count
// as branches of the function that applies them.
const WORDS_RE = /\b(if|for|while|case|catch)\b/g;
const ANDS_RE = /&&/g;
const ORS_RE = /\|\|/g;
const NULLISH_RE = /\?\?/g;
const TERNARY_RE = /\?(?![?.:])/g;

function countWith(code: string, pattern: RegExp): Array<string> {
	return code.match(pattern) ?? [];
}

export function measureCyclomatic(text: string): number {
	const code = blankCode(text);
	const words = countWith(code, WORDS_RE).length;
	const ands = countWith(code, ANDS_RE).length;
	const ors = countWith(code, ORS_RE).length;
	const nullish = countWith(code, NULLISH_RE).length;
	const withoutNullish = code.split("??").join("  ");
	const ternary = countWith(withoutNullish, TERNARY_RE).length;
	return 1 + words + ands + ors + nullish + ternary;
}

function matchBrace(blanked: string, open: number): number {
	let depth = 0;
	for (let index = open; index < blanked.length; index += 1) {
		const char = blanked.charAt(index);
		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function nextBrace(blanked: string, index: number): number {
	const open = blanked.indexOf("{", index);
	return open;
}

// Method shorthand on one line: `name(...) {`, with async/static/get/set.
const METHOD_RE =
	/^[ \t]*(?:async[ \t]+)?(?:static[ \t]+)?(?:get[ \t]+|set[ \t]+)?[A-Za-z_$][\w$]*[ \t]*\([^();{}]*\)[ \t]*\{/gm;

function findStarts(blanked: string): Array<number> {
	const starts: Array<number> = [];
	const seen = new Set<number>();
	const push = (index: number): void => {
		if (!seen.has(index)) {
			seen.add(index);
			starts.push(index);
		}
	};
	for (const match of blanked.matchAll(/\bfunction\b|=>/g)) {
		const at = match.index ?? -1;
		if (at >= 0) {
			push(at);
		}
	}
	for (const match of blanked.matchAll(METHOD_RE)) {
		const at = match.index ?? -1;
		if (at >= 0) {
			push(at + match[0].lastIndexOf("{"));
		}
	}
	return starts.sort((a, b) => a - b);
}

function spanFromBrace(
	starts: ReadonlyArray<number>,
	blanked: string,
	from: number,
): FunctionSpan | undefined {
	const open = nextBrace(blanked, from);
	if (open < 0) {
		return undefined;
	}
	const close = matchBrace(blanked, open);
	if (close < 0) {
		return undefined;
	}
	const line = lineAtIndex(starts, from);
	return { line, lines: lineAtIndex(starts, close) - line + 1 };
}

function spanFromArrow(
	starts: ReadonlyArray<number>,
	blanked: string,
	text: string,
	arrow: number,
): FunctionSpan | undefined {
	const body = skipTrivia(text, arrow + 2);
	if (text.charAt(body) === "{") {
		return spanFromBrace(starts, blanked, arrow);
	}
	const line = lineAtIndex(starts, arrow);
	return { line, lines: 1 };
}

// Every span reports its definition line and length; nested functions report
// separately, so each body is judged on its own.
export function measureFunctionSizes(text: string): Array<FunctionSpan> {
	const blanked = blankCode(text);
	const starts = lineStartsFor(text);
	const spans: Array<FunctionSpan> = [];
	for (const from of findStarts(blanked)) {
		const word = blanked.slice(from, from + 8);
		let span: FunctionSpan | undefined;
		if (word.startsWith("=>")) {
			span = spanFromArrow(starts, blanked, text, from);
		} else if (word.startsWith("function")) {
			span = spanFromBrace(starts, blanked, from);
		} else {
			span = spanFromBrace(starts, blanked, from);
		}
		if (span !== undefined && span.lines > 0) {
			spans.push(span);
		}
	}
	return spans.sort((a, b) => a.line - b.line);
}

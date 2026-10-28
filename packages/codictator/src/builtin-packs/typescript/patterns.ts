// SPEC §6.1 patterns: assertion tokens, skip markers and suppressions for
// the testing-integrity guards (`core/no-assertion-loss`,
// `core/no-skipped-tests`, `core/no-new-suppressions`). Assertion and skip
// counts run over blanked code so comments never inflate them; suppressions
// are comment directives, so they scan the raw lines instead.
import { blankCode, lineAtIndex, lineStartsFor } from "./lex.ts";

// SPEC §6.1: `assert.`, `assert(`, `expect(`, `.should`, `t.assert`.
export const ASSERTION_TOKENS: ReadonlyArray<string> = [
	"assert.",
	"assert(",
	"expect(",
	".should",
	"t.assert",
];

// SPEC §6.1: `.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `fit(`,
// `fdescribe(`, `{ skip: true }`, `{ only: true }`.
export const SKIP_MARKERS: ReadonlyArray<string> = [
	".skip(",
	".only(",
	".todo(",
	"xit(",
	"xdescribe(",
	"fit(",
	"fdescribe(",
	"skip: true",
	"only: true",
];

// SPEC §6.1: lint, type, coverage and analyser suppressions.
export const SUPPRESSION_TOKENS: ReadonlyArray<string> = [
	"eslint-disable",
	"biome-ignore",
	"oxlint-disable",
	"@ts-ignore",
	"@ts-expect-error",
	"@ts-nocheck",
	"istanbul ignore",
	"c8 ignore",
	"v8 ignore",
];

function countToken(code: string, token: string): number {
	let count = 0;
	let index = code.indexOf(token);
	while (index >= 0) {
		count += 1;
		index = code.indexOf(token, index + token.length);
	}
	return count;
}

export function countAssertions(text: string): number {
	const code = blankCode(text);
	let total = 0;
	for (const token of ASSERTION_TOKENS) {
		total += countToken(code, token);
	}
	return total;
}

export interface TextMark {
	readonly line: number;
	readonly marker: string;
}

export function findSkipMarkers(text: string): Array<TextMark> {
	const code = blankCode(text);
	const starts = lineStartsFor(text);
	const marks: Array<TextMark> = [];
	for (const marker of SKIP_MARKERS) {
		let index = code.indexOf(marker);
		while (index >= 0) {
			marks.push({ line: lineAtIndex(starts, index), marker });
			index = code.indexOf(marker, index + marker.length);
		}
	}
	return marks.sort((a, b) => a.line - b.line);
}

export function findSuppressions(text: string): Array<TextMark> {
	const starts = lineStartsFor(text);
	const marks: Array<TextMark> = [];
	for (const token of SUPPRESSION_TOKENS) {
		let index = text.indexOf(token);
		while (index >= 0) {
			marks.push({ line: lineAtIndex(starts, index), marker: token });
			index = text.indexOf(token, index + token.length);
		}
	}
	return marks.sort((a, b) => a.line - b.line);
}

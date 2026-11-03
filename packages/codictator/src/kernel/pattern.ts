// SPEC §9.2: every regex from a pack, config or generator is checked before
// use. Length is capped at 1,000, nested quantifiers over overlapping groups
// ((a+)+-class) and backreferences are rejected, and matching runs per line
// with a 10 ms per-file budget enforced by the caller. Violations fail with
// CDX-E902, never a throw.
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

const MAX_PATTERN_LENGTH = 1000;

function tooLongError(): Result<void> {
	return err(
		makeError(
			"CDX-E902",
			"pattern exceeds the 1,000-character safety budget",
			"Shorten the pattern or split it into several anchored patterns.",
		),
	);
}

function nestedError(): Result<void> {
	return err(
		makeError(
			"CDX-E902",
			"pattern nests a quantifier inside a quantified group",
			"Rewrite without nested quantifiers; match per line instead.",
		),
	);
}

function backreferenceError(): Result<void> {
	return err(
		makeError(
			"CDX-E902",
			"pattern uses a backreference",
			"Rewrite the pattern without backreferences.",
		),
	);
}

function invalidError(): Result<void> {
	return err(
		makeError(
			"CDX-E902",
			"pattern has unbalanced parentheses",
			"Balance every opening parenthesis before using the pattern.",
		),
	);
}

interface GroupFrame {
	readonly quantifiedInside: boolean;
}

interface PatternScan {
	readonly groups: Array<GroupFrame>;
	quantifiedInside: boolean;
	index: number;
}

// The brace-quantifier pattern lives at module scope so its quantifiers
// never count as branches of the function that applies it.
const BRACE_QUANTIFIER_PATTERN = /^\{\d+(,\d*)?\}/;

function scanPatternEscape(
	pattern: string,
	state: PatternScan,
): Result<void> | undefined {
	const next = pattern.charAt(state.index + 1);
	if (next !== "" && next >= "1" && next <= "9") {
		return backreferenceError();
	}
	if (next === "k") {
		return backreferenceError();
	}
	state.index += 2;
	return undefined;
}

function scanPatternClass(pattern: string, state: PatternScan): void {
	let index = state.index + 1;
	if (pattern.charAt(index) === "^") {
		index += 1;
	}
	if (pattern.charAt(index) === "]") {
		index += 1;
	}
	while (index < pattern.length && pattern.charAt(index) !== "]") {
		if (pattern.charAt(index) === "\\") {
			index += 1;
		}
		index += 1;
	}
	state.index = index + 1;
}

function openPatternGroup(pattern: string, state: PatternScan): void {
	state.groups.push({ quantifiedInside: state.quantifiedInside });
	state.quantifiedInside = false;
	const afterParen = state.index + 1;
	// SPEC §9.2: a ? directly after ( opens a non-capturing or
	// lookaround group; it quantifies nothing.
	if (pattern.charAt(afterParen) !== "?") {
		state.index = afterParen;
		return;
	}
	const marker = pattern.charAt(afterParen + 1);
	if (marker === ":" || marker === "=" || marker === "!") {
		state.index = afterParen + 2;
		return;
	}
	if (marker === "<") {
		const close = pattern.indexOf(">", afterParen + 1);
		state.index = close >= 0 ? close + 1 : afterParen + 1;
		return;
	}
	state.index = afterParen + 1;
}

function isGroupQuantifier(quantifier: string): boolean {
	return (
		quantifier === "+" ||
		quantifier === "*" ||
		quantifier === "?" ||
		quantifier === "{"
	);
}

function closePatternGroup(
	pattern: string,
	state: PatternScan,
): Result<void> | undefined {
	const frame = state.groups.pop();
	if (frame === undefined) {
		return invalidError();
	}
	const quantified = isGroupQuantifier(pattern.charAt(state.index + 1));
	if (quantified && state.quantifiedInside) {
		return nestedError();
	}
	state.quantifiedInside = frame.quantifiedInside || quantified;
	state.index += 1;
	return undefined;
}

function markPatternQuantifier(pattern: string, state: PatternScan): void {
	const current = pattern.charAt(state.index);
	if (current === "{") {
		if (BRACE_QUANTIFIER_PATTERN.test(pattern.slice(state.index))) {
			state.quantifiedInside = true;
		}
	} else {
		state.quantifiedInside = true;
	}
	state.index += 1;
}

function isQuantifierStart(current: string): boolean {
	return (
		current === "+" || current === "*" || current === "?" || current === "{"
	);
}

function scanPatternStep(
	pattern: string,
	state: PatternScan,
): Result<void> | undefined {
	const current = pattern.charAt(state.index);
	if (current === "\\") {
		return scanPatternEscape(pattern, state);
	}
	if (current === "[") {
		scanPatternClass(pattern, state);
		return undefined;
	}
	if (current === "(") {
		openPatternGroup(pattern, state);
		return undefined;
	}
	if (current === ")") {
		return closePatternGroup(pattern, state);
	}
	if (isQuantifierStart(current)) {
		markPatternQuantifier(pattern, state);
		return undefined;
	}
	state.index += 1;
	return undefined;
}

function scanPatternBody(pattern: string): Result<void> {
	const state: PatternScan = { groups: [], quantifiedInside: false, index: 0 };
	while (state.index < pattern.length) {
		const failed = scanPatternStep(pattern, state);
		if (failed !== undefined) {
			return failed;
		}
	}
	if (state.groups.length > 0) {
		return invalidError();
	}
	return ok(undefined);
}

// SPEC §9.2: scan with escape and character-class awareness so an escaped
// parenthesis or a bracketed quantifier cannot hide a nested quantifier.
export function checkPattern(pattern: string): Result<void> {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return tooLongError();
	}
	return scanPatternBody(pattern);
}

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

// SPEC §9.2: scan with escape and character-class awareness so an escaped
// parenthesis or a bracketed quantifier cannot hide a nested quantifier.
export function checkPattern(pattern: string): Result<void> {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return tooLongError();
	}
	const groups: Array<GroupFrame> = [];
	let quantifiedInside = false;
	let index = 0;
	while (index < pattern.length) {
		const current = pattern.charAt(index);
		if (current === "\\") {
			const next = pattern.charAt(index + 1);
			if (next !== "" && next >= "1" && next <= "9") {
				return backreferenceError();
			}
			if (next === "k") {
				return backreferenceError();
			}
			index += 2;
			continue;
		}
		if (current === "[") {
			index += 1;
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
			index += 1;
			continue;
		}
		if (current === "(") {
			groups.push({ quantifiedInside });
			quantifiedInside = false;
			index += 1;
			// SPEC §9.2: a ? directly after ( opens a non-capturing or
			// lookaround group; it quantifies nothing.
			if (pattern.charAt(index) === "?") {
				index += 1;
				const marker = pattern.charAt(index);
				if (marker === ":" || marker === "=" || marker === "!") {
					index += 1;
				} else if (marker === "<") {
					const close = pattern.indexOf(">", index);
					if (close >= 0) {
						index = close + 1;
					}
				}
			}
			continue;
		}
		if (current === ")") {
			const frame = groups.pop();
			if (frame === undefined) {
				return invalidError();
			}
			const quantifier = pattern.charAt(index + 1);
			const groupQuantified =
				quantifier === "+" || quantifier === "*" || quantifier === "?";
			const braceQuantified = quantifier === "{";
			if ((groupQuantified || braceQuantified) && quantifiedInside) {
				return nestedError();
			}
			quantifiedInside =
				frame.quantifiedInside || groupQuantified || braceQuantified;
			index += 1;
			continue;
		}
		if (current === "+" || current === "*" || current === "?") {
			quantifiedInside = true;
			index += 1;
			continue;
		}
		if (current === "{") {
			const rest = pattern.slice(index);
			if (/^\{\d+(,\d*)?\}/.test(rest)) {
				quantifiedInside = true;
			}
			index += 1;
			continue;
		}
		index += 1;
	}
	if (groups.length > 0) {
		return invalidError();
	}
	return ok(undefined);
}

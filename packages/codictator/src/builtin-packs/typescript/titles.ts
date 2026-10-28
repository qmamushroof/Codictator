// SPEC §6.1 test titles and filters: `test`/`it`/`describe` string-literal
// titles joined outer to inner; a title built from a variable is unknown and
// the spec trace fails it (§6.4 EC-3). Filters map to the runner flags:
// `--test-name-pattern` (node:test), `-t` (Vitest, Jest).

import { matchWordAt, skipTrivia } from "./extract.ts";
import { lineAtIndex, lineStartsFor } from "./lex.ts";

export interface TestTitle {
	readonly suite: ReadonlyArray<string>;
	readonly title: string;
	readonly line: number;
	readonly literal: boolean;
}

const SUITE_CALLS: ReadonlyArray<string> = ["describe"];
const TEST_CALLS: ReadonlyArray<string> = ["test", "it"];
const FOCUS_PREFIXES: ReadonlyArray<string> = ["", "x", "f"];

function callNameAt(text: string, index: number): string | undefined {
	for (const prefix of FOCUS_PREFIXES) {
		for (const call of [...SUITE_CALLS, ...TEST_CALLS]) {
			const bare = `${prefix}${call}`;
			for (const suffix of [".skip", ".only", ".todo"]) {
				if (matchWordAt(text, index, `${bare}${suffix}`)) {
					return `${bare}${suffix}`;
				}
			}
			if (matchWordAt(text, index, bare)) {
				return bare;
			}
		}
	}
	return undefined;
}

// A literal title is a plain string; concatenation, variables, template
// holes and non-strings are unknown, never guessed.
function readTitleAt(
	text: string,
	index: number,
): {
	readonly title: string;
	readonly literal: boolean;
	readonly next: number;
} {
	const quote = text.charAt(index);
	if (quote !== "'" && quote !== '"' && quote !== "`") {
		let cursor = index;
		let depth = 0;
		while (cursor < text.length) {
			const char = text.charAt(cursor);
			if (char === "(" || char === "[" || char === "{") {
				depth += 1;
			} else if (char === ")" || char === "]" || char === "}") {
				if (depth === 0) {
					break;
				}
				depth -= 1;
			} else if (char === "," && depth === 0) {
				break;
			}
			cursor += 1;
		}
		return { title: "unknown", literal: false, next: cursor };
	}
	let title = "";
	let cursor = index + 1;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\") {
			title += text.slice(cursor, cursor + 2);
			cursor += 2;
			continue;
		}
		if (quote === "`" && char === "$" && text.charAt(cursor + 1) === "{") {
			return { title: "unknown", literal: false, next: cursor };
		}
		if (char === quote) {
			return { title, literal: true, next: cursor + 1 };
		}
		if (char === "\n" && quote !== "`") {
			return { title: "unknown", literal: false, next: cursor };
		}
		title += char;
		cursor += 1;
	}
	return { title: "unknown", literal: false, next: cursor };
}

interface Frame {
	readonly title: string;
	readonly depth: number;
}

// Describes nest by brace depth; a closing brace past the entry depth pops
// the suite, so sibling suites never leak into each other.
export function extractTestTitles(text: string): Array<TestTitle> {
	const starts = lineStartsFor(text);
	const found: Array<TestTitle> = [];
	const stack: Array<Frame> = [];
	let depth = 0;
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "{") {
			depth += 1;
			index += 1;
			continue;
		}
		if (char === "}") {
			depth -= 1;
			while (stack.length > 0) {
				const top = stack[stack.length - 1];
				if (top !== undefined && top.depth < depth) {
					break;
				}
				stack.pop();
			}
			index += 1;
			continue;
		}
		const call = callNameAt(text, index);
		if (call === undefined) {
			index += 1;
			continue;
		}
		const base = call.split(".", 1)[0] ?? call;
		const isSuite =
			base === "describe" || base === "xdescribe" || base === "fdescribe";
		const open = skipTrivia(text, index + call.length);
		if (text.charAt(open) !== "(") {
			index += 1;
			continue;
		}
		const arg = skipTrivia(text, open + 1);
		const title = readTitleAt(text, arg);
		if (isSuite) {
			if (title.literal) {
				stack.push({ title: title.title, depth });
			}
		} else {
			found.push({
				suite: stack.map((frame) => frame.title),
				title: title.title,
				line: lineAtIndex(starts, index),
				literal: title.literal,
			});
		}
		index = title.next;
	}
	return found;
}

export type TestRunner = "node" | "vitest" | "jest";

// SPEC §6.1: runner filter flags for a title pattern.
export function testFilterArg(
	runner: TestRunner,
	pattern: string,
): ReadonlyArray<string> {
	if (runner === "node") {
		return ["--test-name-pattern", pattern];
	}
	return ["-t", pattern];
}

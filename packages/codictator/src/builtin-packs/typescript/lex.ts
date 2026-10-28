// SPEC §4.11.3 + §6.1: shared lexical helpers for the TypeScript supplies.
// Comment and string blanking keeps every offset and newline stable, so the
// measures map findings back to source lines without a compiler API (the
// zero-deps rule for packages/codictator forbids the TypeScript compiler).

// SPEC §6.1 file naming: the extensions the TypeScript pack judges.
export const TYPESCRIPT_SOURCE_EXTENSIONS: ReadonlyArray<string> = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
];

export function isTypeScriptFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return TYPESCRIPT_SOURCE_EXTENSIONS.some((extension) =>
		lowered.endsWith(extension),
	);
}

// SPEC §4.11 EC-13: Windows separators normalise before resolution.
export function toPosixPath(path: string): string {
	return path.split("\\").join("/");
}

// Line starts for mapping an offset back to a 1-based line.
export function lineStartsFor(text: string): Array<number> {
	const starts: Array<number> = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text.charAt(index) === "\n") {
			starts.push(index + 1);
		}
	}
	return starts;
}

// Binary search over the starts table; the result is 1-based.
export function lineAtIndex(
	starts: ReadonlyArray<number>,
	index: number,
): number {
	let low = 0;
	let high = starts.length - 1;
	let line = 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const start = starts[mid] ?? 0;
		if (start <= index) {
			line = mid + 1;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return line;
}

interface BlankState {
	readonly out: Array<string>;
	index: number;
	state: "code" | "line" | "block" | "string";
	quote: string;
	depth: number;
	readonly templateTops: Array<number>;
}

function pushNewlineOrSpace(state: BlankState, char: string): void {
	state.out.push(char === "\n" ? "\n" : " ");
	state.index += 1;
}

function stepLineComment(state: BlankState, char: string): void {
	if (char === "\n") {
		state.state = "code";
		state.out.push(char);
	} else {
		state.out.push(" ");
	}
	state.index += 1;
}

function stepBlockComment(state: BlankState, text: string): void {
	const char = text.charAt(state.index);
	const next = text.charAt(state.index + 1);
	if (char === "*" && next === "/") {
		state.state = "code";
		state.out.push(" ", " ");
		state.index += 2;
		return;
	}
	pushNewlineOrSpace(state, char);
}

function stepString(state: BlankState, text: string): void {
	const char = text.charAt(state.index);
	const next = text.charAt(state.index + 1);
	if (char === "\\") {
		state.out.push(" ", " ");
		state.index += 2;
		return;
	}
	if (state.quote === "`" && char === "$" && next === "{") {
		state.templateTops.push(state.depth);
		state.depth += 1;
		state.state = "code";
		state.out.push(" ", " ");
		state.index += 2;
		return;
	}
	if (char === state.quote) {
		state.state = "code";
		state.out.push(" ");
		state.index += 1;
		return;
	}
	pushNewlineOrSpace(state, char);
}

function stepCodeBrace(state: BlankState, char: string): boolean {
	if (char === "{") {
		state.depth += 1;
		state.out.push(char);
		state.index += 1;
		return true;
	}
	if (char === "}") {
		state.depth -= 1;
		if (state.depth < 0) {
			state.depth = 0;
		}
		const top = state.templateTops[state.templateTops.length - 1];
		if (top !== undefined && state.depth === top) {
			state.templateTops.pop();
			state.state = "string";
			state.quote = "`";
		}
		state.out.push(char);
		state.index += 1;
		return true;
	}
	return false;
}

function stepCode(state: BlankState, text: string): void {
	const char = text.charAt(state.index);
	const next = text.charAt(state.index + 1);
	if (char === "/" && next === "/") {
		state.state = "line";
		state.out.push(" ", " ");
		state.index += 2;
		return;
	}
	if (char === "/" && next === "*") {
		state.state = "block";
		state.out.push(" ", " ");
		state.index += 2;
		return;
	}
	if (char === "'" || char === '"' || char === "`") {
		state.state = "string";
		state.quote = char;
		state.out.push(" ");
		state.index += 1;
		return;
	}
	if (!stepCodeBrace(state, char)) {
		state.out.push(char);
		state.index += 1;
	}
}

// SPEC §4.11.3: the lexer ignores `require` inside strings and comments
// (EC-7); blanking them first keeps every later regex honest.
export function blankCode(text: string): string {
	const state: BlankState = {
		out: [],
		index: 0,
		state: "code",
		quote: "",
		depth: 0,
		templateTops: [],
	};
	while (state.index < text.length) {
		if (state.state === "code") {
			stepCode(state, text);
		} else if (state.state === "line") {
			stepLineComment(state, text.charAt(state.index));
		} else if (state.state === "block") {
			stepBlockComment(state, text);
		} else {
			stepString(state, text);
		}
	}
	return state.out.join("");
}

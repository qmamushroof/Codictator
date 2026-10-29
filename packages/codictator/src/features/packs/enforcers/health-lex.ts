// SPEC §6.1 lexing: comment and string blanking shared by the pack
// enforcers. Char-for-char, so every index still maps to the original line.
// Char-for-char blanking of comments and strings: keywords inside them
// never count, and every index still maps to the original line.
type LexState = "code" | "line" | "block" | "sq" | "dq" | "tpl";

interface LexScan {
	index: number;
	state: LexState;
}

function copyChars(text: string): Array<string> {
	const out: Array<string> = new Array<string>(text.length);
	for (let index = 0; index < text.length; index += 1) {
		out[index] = text.charAt(index);
	}
	return out;
}

function quoteStateFor(char: string): LexState | undefined {
	if (char === "'") {
		return "sq";
	}
	if (char === '"') {
		return "dq";
	}
	if (char === "`") {
		return "tpl";
	}
	return undefined;
}

function isQuoteCloser(state: LexState, char: string): boolean {
	if (state === "sq") {
		return char === "'";
	}
	if (state === "dq") {
		return char === '"';
	}
	return char === "`";
}

// Comment openers blank in both modes; the caller decides about quotes.
function stepCodeComment(
	text: string,
	out: Array<string>,
	scan: LexScan,
): boolean {
	const char = text.charAt(scan.index);
	const next = text.charAt(scan.index + 1);
	if (char === "/" && next === "/") {
		scan.state = "line";
		out[scan.index] = " ";
		out[scan.index + 1] = " ";
		scan.index += 2;
		return true;
	}
	if (char === "/" && next === "*") {
		scan.state = "block";
		out[scan.index] = " ";
		out[scan.index + 1] = " ";
		scan.index += 2;
		return true;
	}
	return false;
}

function stepCodeQuote(
	text: string,
	out: Array<string>,
	scan: LexScan,
	blank: boolean,
): boolean {
	const opened = quoteStateFor(text.charAt(scan.index));
	if (opened === undefined) {
		return false;
	}
	scan.state = opened;
	if (blank) {
		out[scan.index] = " ";
	}
	scan.index += 1;
	return true;
}

function stepLineComment(
	out: Array<string>,
	scan: LexScan,
	char: string,
): void {
	if (char === "\n") {
		scan.state = "code";
	} else {
		out[scan.index] = " ";
	}
	scan.index += 1;
}

function stepBlockComment(
	out: Array<string>,
	scan: LexScan,
	char: string,
	next: string,
): void {
	if (char === "*" && next === "/") {
		out[scan.index] = " ";
		out[scan.index + 1] = " ";
		scan.index += 2;
		scan.state = "code";
		return;
	}
	if (char !== "\n") {
		out[scan.index] = " ";
	}
	scan.index += 1;
}

function stepEscape(
	text: string,
	out: Array<string>,
	scan: LexScan,
	blank: boolean,
): void {
	if (blank) {
		out[scan.index] = " ";
		if (scan.index + 1 < text.length && text.charAt(scan.index + 1) !== "\n") {
			out[scan.index + 1] = " ";
		}
	}
	scan.index += 2;
}

function stepQuoted(
	text: string,
	out: Array<string>,
	scan: LexScan,
	char: string,
	blank: boolean,
): void {
	if (char === "\\") {
		stepEscape(text, out, scan, blank);
		return;
	}
	if (blank && char !== "\n") {
		out[scan.index] = " ";
	}
	scan.index += 1;
	if (isQuoteCloser(scan.state, char)) {
		scan.state = "code";
	}
}

// One pass over the text; comment openers always blank, string
// contents blank only for blankCode.
function runBlank(text: string, blankStrings: boolean): string {
	const out = copyChars(text);
	const scan: LexScan = { index: 0, state: "code" };
	while (scan.index < text.length) {
		const char = text.charAt(scan.index);
		const next = text.charAt(scan.index + 1);
		if (scan.state === "code") {
			if (stepCodeComment(text, out, scan)) {
				continue;
			}
			if (stepCodeQuote(text, out, scan, blankStrings)) {
				continue;
			}
			scan.index += 1;
			continue;
		}
		if (scan.state === "line") {
			stepLineComment(out, scan, char);
			continue;
		}
		if (scan.state === "block") {
			stepBlockComment(out, scan, char, next);
			continue;
		}
		stepQuoted(text, out, scan, char, blankStrings);
	}
	return out.join("");
}

export function blankCode(text: string): string {
	return runBlank(text, true);
}

// Comment-only blanking: strings survive so import specifiers stay
// readable while commented-out imports never count.
export function blankComments(text: string): string {
	return runBlank(text, false);
}

// Word match with boundaries on both sides, so `required` never reads as
// `require` and `important` never reads as `import`.
export function isSpaceChar(char: string): boolean {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\v" ||
		char === "\f" ||
		char === "\u00a0"
	);
}

// Skip a quoted region; a template holding `${}` is skipped whole, so
// code inside holes never reads as top-level code.
export function skipQuoted(text: string, index: number): number {
	const quote = text.charAt(index);
	let cursor = index + 1;
	let depth = 0;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\") {
			cursor += 2;
			continue;
		}
		if (quote === "`") {
			if (char === "$" && text.charAt(cursor + 1) === "{") {
				depth += 1;
				cursor += 2;
				continue;
			}
			if (char === "}" && depth > 0) {
				depth -= 1;
				cursor += 1;
				continue;
			}
		}
		if (char === quote && depth === 0) {
			return cursor + 1;
		}
		cursor += 1;
	}
	return cursor;
}

// Read a literal specifier; a template holding `${}` is not a literal, so
// the caller reports it unresolvable instead of inventing a target.
export function readLiteral(
	text: string,
	index: number,
): { readonly value: string; readonly next: number } | undefined {
	const quote = text.charAt(index);
	if (quote !== "'" && quote !== '"' && quote !== "`") {
		return undefined;
	}
	if (quote === "`") {
		const end = skipQuoted(text, index);
		const body = text.slice(index + 1, end - 1);
		if (body.includes("${")) {
			return undefined;
		}
		return { value: body, next: end };
	}
	let value = "";
	let cursor = index + 1;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\" && cursor + 1 < text.length) {
			value += text.charAt(cursor + 1);
			cursor += 2;
			continue;
		}
		if (char === quote) {
			return { value, next: cursor + 1 };
		}
		if (char === "\n") {
			return undefined;
		}
		value += char;
		cursor += 1;
	}
	return undefined;
}

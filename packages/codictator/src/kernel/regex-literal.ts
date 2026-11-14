// SPEC §6.1 lexing: regex-literal detection shared by every code blanker, so
// a quote inside a regex literal never opens a string state. A literal that
// starts where a value cannot (after an operator, an opener or a value
// keyword) and closes on the same line is a regex; anything ambiguous stays
// division and scans as code, so a blanker never swallows real code.

const REGEX_OPENERS = "(,=:[!&|?{;~^";
const REGEX_KEYWORDS: ReadonlySet<string> = new Set([
	"return",
	"typeof",
	"case",
	"in",
	"of",
	"void",
	"delete",
	"throw",
	"new",
	"else",
	"do",
	"yield",
	"await",
]);

function isWordChar(char: string): boolean {
	return /[A-Za-z0-9_$]/.test(char);
}

// A regex can start here only when the previous significant character leaves
// a value expected: the start of the text, an opener, or a value keyword.
function regexMayStart(text: string, index: number): boolean {
	let at = index - 1;
	while (at >= 0 && text.charAt(at).trim() === "") {
		at -= 1;
	}
	if (at < 0) {
		return true;
	}
	const previous = text.charAt(at);
	if (REGEX_OPENERS.includes(previous)) {
		return true;
	}
	// An arrow body, never a JSX closing tag or a generic: only `=>` opens.
	if (previous === ">") {
		return text.charAt(at - 1) === "=";
	}
	if (!isWordChar(previous)) {
		return false;
	}
	let start = at;
	while (start > 0 && isWordChar(text.charAt(start - 1))) {
		start -= 1;
	}
	return REGEX_KEYWORDS.has(text.slice(start, at + 1));
}

// The index of the closing slash of the regex literal that starts at index,
// or undefined when no literal starts there: not a slash, a slash where a
// value is not expected, or a literal that does not close on its own line.
export function regexLiteralEnd(
	text: string,
	index: number,
): number | undefined {
	if (text.charAt(index) !== "/" || !regexMayStart(text, index)) {
		return undefined;
	}
	let inClass = false;
	for (let at = index + 1; at < text.length; at += 1) {
		const char = text.charAt(at);
		if (char === "\n") {
			return undefined;
		}
		if (char === "\\") {
			at += 1;
		} else if (inClass) {
			inClass = char !== "]";
		} else if (char === "[") {
			inClass = true;
		} else if (char === "/") {
			return at > index + 1 ? at : undefined;
		}
	}
	return undefined;
}

// SPEC §4.7.2: decoding of a quoted YAML scalar on one line, so the shell
// text of a quoted `run:` value is analysed as the shell receives it. A value
// that cannot be decoded exactly (no closing quote on the line, an unknown
// escape) returns undefined and the caller fails closed.
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
	n: String.fromCharCode(10),
	t: String.fromCharCode(9),
	r: String.fromCharCode(13),
	"0": String.fromCharCode(0),
	'"': '"',
	"/": "/",
	" ": " ",
	"\\": "\\",
};

const HEX_ESCAPES: Readonly<Record<string, number>> = { x: 2, u: 4 };

interface Decoded {
	readonly text: string;
	readonly end: number;
}

// The escape starting at the backslash at `at`, and the index of its last
// character.
function decodeEscape(text: string, at: number): Decoded | undefined {
	const code = text.charAt(at + 1);
	const simple = SIMPLE_ESCAPES[code];
	if (simple !== undefined) {
		return { text: simple, end: at + 1 };
	}
	const width = HEX_ESCAPES[code];
	const digits = text.slice(at + 2, at + 2 + (width ?? 0));
	if (
		width === undefined ||
		!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(digits)
	) {
		return undefined;
	}
	return {
		text: String.fromCharCode(Number.parseInt(digits, 16)),
		end: at + 1 + width,
	};
}

// Only whitespace or a comment may follow the closing quote.
function closedTail(tail: string): boolean {
	return tail.trim() === "" || /^\s+#/.test(tail);
}

// The decoded value of a single- or double-quoted scalar that opens at the
// start of `text` and closes on the same line.
export function unquoteScalar(text: string): string | undefined {
	const quote = text.charAt(0);
	let out = "";
	for (let at = 1; at < text.length; at += 1) {
		const char = text.charAt(at);
		if (char === quote && quote === "'" && text.charAt(at + 1) === "'") {
			out += "'";
			at += 1;
		} else if (char === quote) {
			return closedTail(text.slice(at + 1)) ? out : undefined;
		} else if (char === "\\" && quote === '"') {
			const decoded = decodeEscape(text, at);
			if (decoded === undefined) {
				return undefined;
			}
			out += decoded.text;
			at = decoded.end;
		} else {
			out += char;
		}
	}
	return undefined;
}

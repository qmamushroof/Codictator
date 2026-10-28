// SPEC §4.7.2: word-level lexing for the shell analyser. Pure scanners
// over (text, index): quotes with $(…) and backtick descent, balanced
// groups, bare words, redirection operators and heredoc bodies. The parser
// feeds nested command text back through a descend callback, so this file
// never imports the parser.
import { ParseFailure } from "./shell.ts";

export interface WordRead {
	readonly value: string;
	readonly next: number;
}

export function skipShellComment(text: string, index: number): number {
	let at = index;
	while (at < text.length && text[at] !== "\n") {
		at += 1;
	}
	return at;
}

function descendQuoted(
	text: string,
	index: number,
	descend: (inner: string) => void,
): WordRead {
	let at = index + 1;
	const start = at;
	while (at < text.length) {
		const innerChar = text[at];
		if (innerChar === "\\") {
			at += 2;
			continue;
		}
		if (innerChar === "`") {
			break;
		}
		at += 1;
	}
	if (at >= text.length) {
		throw new ParseFailure();
	}
	const inner = text.slice(start, at);
	descend(inner);
	return { value: inner, next: at + 1 };
}

// SPEC §4.7.2: single quotes are literal; double quotes keep $() and
// backtick descent; an unclosed quote fails CDX-E306 upstream.
export function readShellQuoted(
	text: string,
	index: number,
	descend: (inner: string) => void,
): WordRead {
	const quote = text[index];
	if (quote === "`") {
		const inner = readShellBalanced(text, index + 1, "`");
		descend(inner.value);
		return inner;
	}
	const out: Array<string> = [];
	let at = index + 1;
	while (at < text.length) {
		const char = text[at];
		if (char === quote) {
			return { value: out.join(""), next: at + 1 };
		}
		if (char === "\\" && quote === '"') {
			const next = text[at + 1];
			if (next === "\n") {
				at += 2;
				continue;
			}
			if (next !== undefined) {
				out.push(next);
				at += 2;
				continue;
			}
			throw new ParseFailure();
		}
		if (quote === '"' && char === "$" && text[at + 1] === "(") {
			const inner = readShellBalanced(text, at + 2, ")");
			descend(inner.value);
			out.push(inner.value);
			at = inner.next;
			continue;
		}
		if (quote === '"' && char === "`") {
			const inner = descendQuoted(text, at, descend);
			out.push(inner.value);
			at = inner.next;
			continue;
		}
		out.push(char ?? "");
		at += 1;
	}
	throw new ParseFailure();
}

// SPEC §4.7.2: quote-aware extent scan for $(…), `…`, (…) and {…}. Only
// the extent is found here; descent happens at the call site.
export function readShellBalanced(
	text: string,
	index: number,
	close: string,
): WordRead {
	let depth = 1;
	let at = index;
	const start = at;
	let quote: string | undefined;
	while (at < text.length) {
		const char = text[at];
		if (quote !== undefined) {
			if (char === "\\") {
				at += 2;
				continue;
			}
			if (char === quote) {
				quote = undefined;
			}
			at += 1;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			at += 1;
			continue;
		}
		if (char === "$" && text[at + 1] === "(" && close === ")") {
			depth += 1;
			at += 2;
			continue;
		}
		if (char === "(" && close === ")") {
			depth += 1;
			at += 1;
			continue;
		}
		if (char === close) {
			depth -= 1;
			if (depth === 0) {
				return { value: text.slice(start, at), next: at + 1 };
			}
			at += 1;
			continue;
		}
		at += 1;
	}
	throw new ParseFailure();
}

const WORD_STOPS = new Set([
	" ",
	"\t",
	"\n",
	";",
	"&",
	"|",
	"(",
	")",
	"{",
	"}",
	"<",
	">",
	"'",
	'"',
	"`",
	"#",
]);

export function readShellWord(
	text: string,
	index: number,
	descend: (inner: string) => void,
): WordRead {
	const out: Array<string> = [];
	let at = index;
	while (at < text.length) {
		const char = text[at];
		if (char === undefined || WORD_STOPS.has(char)) {
			break;
		}
		if (char === "\\") {
			const next = text[at + 1];
			if (next === "\n") {
				at += 2;
				continue;
			}
			if (next !== undefined) {
				out.push(next);
				at += 2;
				continue;
			}
			throw new ParseFailure();
		}
		if (char === "$" && text[at + 1] === "(") {
			const inner = readShellBalanced(text, at + 2, ")");
			descend(inner.value);
			out.push(inner.value);
			at = inner.next;
			continue;
		}
		out.push(char);
		at += 1;
	}
	return { value: out.join(""), next: at };
}

const REDIRECT_WORDS = new Set(["<<-", "<<<", "<<", ">>", ">|", "&>", ">&"]);

export interface OperatorRead {
	readonly operator: string;
	readonly next: number;
	readonly dropFd: boolean;
}

export function readShellOperator(
	text: string,
	index: number,
	lastWord: string | undefined,
): OperatorRead | undefined {
	const rest = text.slice(index);
	for (const operator of REDIRECT_WORDS) {
		if (rest.startsWith(operator)) {
			return { operator, next: index + operator.length, dropFd: false };
		}
	}
	const char = text[index];
	if (char === ">" || char === "<") {
		const dropFd =
			char === ">" && lastWord !== undefined && /^\d+$/.test(lastWord);
		return { operator: char, next: index + 1, dropFd };
	}
	return undefined;
}

// SPEC §4.7.2: a heredoc without a terminator is unparseable (CDX-E306).
export function readShellHeredoc(
	text: string,
	index: number,
	delimiter: string,
	stripTabs: boolean,
): WordRead {
	let at = index;
	if (text[at] === "\n") {
		at += 1;
	}
	const body: Array<string> = [];
	while (at < text.length) {
		const end = text.indexOf("\n", at);
		const line = end < 0 ? text.slice(at) : text.slice(at, end);
		const compared = stripTabs ? line.replace(/^\t+/, "") : line;
		if (compared === delimiter) {
			return { value: body.join("\n"), next: end < 0 ? text.length : end + 1 };
		}
		body.push(line);
		if (end < 0) {
			throw new ParseFailure();
		}
		at = end + 1;
	}
	throw new ParseFailure();
}

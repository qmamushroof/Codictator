// SPEC §4.1.2: globMatch supports *, **, ?, {a,b} and [...]. Matching is
// case-sensitive except on Windows and macOS default volumes, where the
// repo's case is canonical and both sides fold before comparing.
const REGEXP_SPECIALS: ReadonlySet<string> = new Set([
	".",
	"^",
	"$",
	"+",
	"(",
	")",
	"|",
	"\\",
	"*",
	"?",
	"{",
	"}",
	"[",
	"]",
]);

function foldCase(text: string): string {
	if (process.platform === "win32" || process.platform === "darwin") {
		return text.toLowerCase();
	}
	return text;
}

function emitLiteral(source: Array<string>, char: string): void {
	if (REGEXP_SPECIALS.has(char)) {
		source.push("\\");
	}
	source.push(char);
}

// Parses {a,b} with nesting; returns the alternation source and the index
// just past }. Undefined when no closing brace exists (literal { then).
function parseBraces(
	pattern: string,
	start: number,
): { readonly source: string; readonly next: number } | undefined {
	let index = start;
	const parts: Array<string> = [];
	let current: Array<string> = [];
	while (index < pattern.length) {
		const char = pattern.charAt(index);
		if (char === "\\" && index + 1 < pattern.length) {
			emitLiteral(current, pattern.charAt(index + 1));
			index += 2;
			continue;
		}
		if (char === "{") {
			const nested = parseBraces(pattern, index + 1);
			if (nested === undefined) {
				emitLiteral(current, char);
				index += 1;
				continue;
			}
			current.push(nested.source);
			index = nested.next;
			continue;
		}
		if (char === "}") {
			parts.push(current.join(""));
			return { source: `(?:${parts.join("|")})`, next: index + 1 };
		}
		if (char === ",") {
			parts.push(current.join(""));
			current = [];
			index += 1;
			continue;
		}
		if (char === "*" || char === "?" || char === "[") {
			const nested = emitGlob(pattern, index);
			current.push(nested.source);
			index = nested.next;
			continue;
		}
		emitLiteral(current, char);
		index += 1;
	}
	return undefined;
}

// Parses [...] classes; leading ! becomes a regex negation. Undefined when
// no closing bracket exists (literal [ then).
function parseClass(
	pattern: string,
	start: number,
): { readonly source: string; readonly next: number } | undefined {
	let index = start + 1;
	let body = "";
	if (pattern.charAt(index) === "!") {
		body += "^";
		index += 1;
	} else if (pattern.charAt(index) === "^") {
		body += "\\^";
		index += 1;
	}
	if (pattern.charAt(index) === "]") {
		body += "\\]";
		index += 1;
	}
	while (index < pattern.length && pattern.charAt(index) !== "]") {
		const char = pattern.charAt(index);
		if (char === "\\" && index + 1 < pattern.length) {
			body += `\\${pattern.charAt(index + 1)}`;
			index += 2;
			continue;
		}
		body += char;
		index += 1;
	}
	if (index >= pattern.length) {
		return undefined;
	}
	return { source: `[${body}]`, next: index + 1 };
}

function emitGlob(
	pattern: string,
	start: number,
): { readonly source: string; readonly next: number } {
	const char = pattern.charAt(start);
	if (char === "*") {
		let index = start;
		while (pattern.charAt(index) === "*") {
			index += 1;
		}
		const doubled = index - start >= 2;
		if (doubled) {
			if (pattern.charAt(index) === "/") {
				return { source: "(?:.*/)?", next: index + 1 };
			}
			return { source: ".*", next: index };
		}
		return { source: "[^/]*", next: index };
	}
	if (char === "?") {
		return { source: "[^/]", next: start + 1 };
	}
	if (char === "{") {
		const braces = parseBraces(pattern, start + 1);
		if (braces !== undefined) {
			return braces;
		}
		return { source: "\\{", next: start + 1 };
	}
	if (char === "[") {
		const cls = parseClass(pattern, start);
		if (cls !== undefined) {
			return cls;
		}
		return { source: "\\[", next: start + 1 };
	}
	return { source: `\\${char}`, next: start + 1 };
}

function globToRegExp(pattern: string): RegExp {
	let core = pattern;
	let suffix = "";
	if (core === "**") {
		return /^.*$/;
	}
	if (core.endsWith("/**")) {
		core = core.slice(0, -3);
		suffix = "(?:/.*)?";
	}
	const source: Array<string> = ["^"];
	let index = 0;
	while (index < core.length) {
		const char = core.charAt(index);
		if (char === "\\" && index + 1 < core.length) {
			emitLiteral(source, core.charAt(index + 1));
			index += 2;
			continue;
		}
		if (char === "*" || char === "?" || char === "{" || char === "[") {
			const emitted = emitGlob(core, index);
			source.push(emitted.source);
			index = emitted.next;
			continue;
		}
		emitLiteral(source, char);
		index += 1;
	}
	source.push(suffix);
	source.push("$");
	return new RegExp(source.join(""));
}

export function globMatch(pattern: string, path: string): boolean {
	return globToRegExp(foldCase(pattern)).test(foldCase(path));
}

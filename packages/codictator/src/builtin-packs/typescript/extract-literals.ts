// SPEC §4.11.3 + §6.1: quoted-region scanners for the TypeScript import
// extractor. Strings and comments never yield edges (§4.11 EC-7), so these
// skippers keep every later scan honest without the compiler API.

// Skip a quoted region; template `${}` holes recurse through balanced code.
function skipBalanced(text: string, index: number): number {
	let cursor = index + 1;
	let depth = 1;
	while (cursor < text.length && depth > 0) {
		const nested = skipAtom(text, cursor);
		if (text.charAt(nested) === "{") {
			depth += 1;
		} else if (text.charAt(nested) === "}") {
			depth -= 1;
		}
		cursor = nested + 1;
	}
	return cursor;
}

export function skipQuoted(text: string, index: number, quote: string): number {
	let cursor = index + 1;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\") {
			cursor += 2;
			continue;
		}
		if (quote === "`" && char === "$" && text.charAt(cursor + 1) === "{") {
			cursor = skipBalanced(text, cursor + 1);
			continue;
		}
		if (char === quote) {
			return cursor + 1;
		}
		cursor += 1;
	}
	return cursor;
}

function isQuoteChar(char: string): boolean {
	return char === "'" || char === '"' || char === "`";
}

function skipLineToEnd(text: string, index: number): number {
	let cursor = index;
	while (cursor < text.length && text.charAt(cursor) !== "\n") {
		cursor += 1;
	}
	return cursor;
}

function skipBlockToEnd(text: string, index: number): number {
	let cursor = index + 2;
	while (cursor < text.length) {
		if (text.charAt(cursor) === "*" && text.charAt(cursor + 1) === "/") {
			return cursor + 2;
		}
		cursor += 1;
	}
	return cursor;
}

export function skipAtom(text: string, index: number): number {
	const char = text.charAt(index);
	const next = text.charAt(index + 1);
	if (char === "/" && next === "/") {
		return skipLineToEnd(text, index);
	}
	if (char === "/" && next === "*") {
		return skipBlockToEnd(text, index);
	}
	if (isQuoteChar(char)) {
		return skipQuoted(text, index, char);
	}
	return index;
}

// Reads a literal specifier; a template holding `${}` is not a literal, so
// the caller reports it unresolvable instead of inventing a target.
export function readStringLiteral(
	text: string,
	index: number,
): { readonly value: string; readonly next: number } | undefined {
	const quote = text.charAt(index);
	if (quote !== "'" && quote !== '"' && quote !== "`") {
		return undefined;
	}
	let value = "";
	let cursor = index + 1;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		if (char === "\\") {
			value += text.slice(cursor, cursor + 2);
			cursor += 2;
			continue;
		}
		if (quote === "`" && char === "$" && text.charAt(cursor + 1) === "{") {
			return undefined;
		}
		if (char === quote) {
			return { value, next: cursor + 1 };
		}
		if (char === "\n" && quote !== "`") {
			return undefined;
		}
		value += char;
		cursor += 1;
	}
	return undefined;
}

// SPEC §4.11.3 + §6.1: word-boundary and trivia primitives shared by the
// TypeScript import extractor and its sibling supplies (measures, titles).

export function isWordChar(char: string): boolean {
	return (
		(char >= "A" && char <= "Z") ||
		(char >= "a" && char <= "z") ||
		(char >= "0" && char <= "9") ||
		char === "_" ||
		char === "$"
	);
}

// A keyword match needs boundaries on both sides, so `required` never reads
// as `require` and `important` never reads as `import`.
export function matchWordAt(
	text: string,
	index: number,
	word: string,
): boolean {
	if (!text.startsWith(word, index)) {
		return false;
	}
	const before = index === 0 ? "" : text.charAt(index - 1);
	const after = text.charAt(index + word.length);
	if (before !== "" && isWordChar(before)) {
		return false;
	}
	if (after !== "" && isWordChar(after)) {
		return false;
	}
	return true;
}

function isTriviaSpace(char: string): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function skipLineEnd(text: string, cursor: number): number {
	let end = cursor;
	while (end < text.length && text.charAt(end) !== "\n") {
		end += 1;
	}
	return end;
}

function skipBlockEnd(text: string, cursor: number): number {
	let end = cursor + 2;
	while (end < text.length) {
		if (text.charAt(end) === "*" && text.charAt(end + 1) === "/") {
			return end + 2;
		}
		end += 1;
	}
	return end;
}

// Whitespace and comments end wherever a string or code token starts.
export function skipTrivia(text: string, index: number): number {
	let cursor = index;
	while (cursor < text.length) {
		const char = text.charAt(cursor);
		const next = text.charAt(cursor + 1);
		if (isTriviaSpace(char)) {
			cursor += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			cursor = skipLineEnd(text, cursor);
			continue;
		}
		if (char === "/" && next === "*") {
			cursor = skipBlockEnd(text, cursor);
			continue;
		}
		break;
	}
	return cursor;
}

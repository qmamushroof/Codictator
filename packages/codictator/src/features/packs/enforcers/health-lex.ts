// SPEC §6.1 lexing: comment and string blanking shared by the pack
// enforcers. Char-for-char, so every index still maps to the original line.
// Char-for-char blanking of comments and strings: keywords inside them
// never count, and every index still maps to the original line.
export function blankCode(text: string): string {
	const out: Array<string> = new Array<string>(text.length);
	for (let index = 0; index < text.length; index += 1) {
		out[index] = text.charAt(index);
	}
	let index = 0;
	let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
	while (index < text.length) {
		const char = text.charAt(index);
		const next = text.charAt(index + 1);
		if (state === "code") {
			if (char === "/" && next === "/") {
				state = "line";
				out[index] = " ";
				out[index + 1] = " ";
				index += 2;
				continue;
			}
			if (char === "/" && next === "*") {
				state = "block";
				out[index] = " ";
				out[index + 1] = " ";
				index += 2;
				continue;
			}
			if (char === "'") {
				state = "sq";
				out[index] = " ";
				index += 1;
				continue;
			}
			if (char === '"') {
				state = "dq";
				out[index] = " ";
				index += 1;
				continue;
			}
			if (char === "`") {
				state = "tpl";
				out[index] = " ";
				index += 1;
				continue;
			}
			index += 1;
			continue;
		}
		if (state === "line") {
			if (char === "\n") {
				state = "code";
			} else {
				out[index] = " ";
			}
			index += 1;
			continue;
		}
		if (state === "block") {
			if (char === "*" && next === "/") {
				out[index] = " ";
				out[index + 1] = " ";
				index += 2;
				state = "code";
				continue;
			}
			if (char !== "\n") {
				out[index] = " ";
			}
			index += 1;
			continue;
		}
		if (char === "\\") {
			out[index] = " ";
			if (index + 1 < text.length && text.charAt(index + 1) !== "\n") {
				out[index + 1] = " ";
			}
			index += 2;
			continue;
		}
		const closes =
			(state === "sq" && char === "'") ||
			(state === "dq" && char === '"') ||
			(state === "tpl" && char === "`");
		if (char !== "\n") {
			out[index] = " ";
		}
		index += 1;
		if (closes) {
			state = "code";
		}
	}
	return out.join("");
}

// Comment-only blanking: strings survive so import specifiers stay
// readable while commented-out imports never count.
export function blankComments(text: string): string {
	const out: Array<string> = new Array<string>(text.length);
	for (let index = 0; index < text.length; index += 1) {
		out[index] = text.charAt(index);
	}
	let index = 0;
	let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
	while (index < text.length) {
		const char = text.charAt(index);
		const next = text.charAt(index + 1);
		if (state === "code") {
			if (char === "/" && next === "/") {
				state = "line";
				out[index] = " ";
				out[index + 1] = " ";
				index += 2;
				continue;
			}
			if (char === "/" && next === "*") {
				state = "block";
				out[index] = " ";
				out[index + 1] = " ";
				index += 2;
				continue;
			}
			if (char === "'") {
				state = "sq";
				index += 1;
				continue;
			}
			if (char === '"') {
				state = "dq";
				index += 1;
				continue;
			}
			if (char === "`") {
				state = "tpl";
				index += 1;
				continue;
			}
			index += 1;
			continue;
		}
		if (state === "line") {
			if (char === "\n") {
				state = "code";
			} else {
				out[index] = " ";
			}
			index += 1;
			continue;
		}
		if (state === "block") {
			if (char === "*" && next === "/") {
				out[index] = " ";
				out[index + 1] = " ";
				index += 2;
				state = "code";
				continue;
			}
			if (char !== "\n") {
				out[index] = " ";
			}
			index += 1;
			continue;
		}
		if (char === "\\") {
			index += 2;
			continue;
		}
		const closes =
			(state === "sq" && char === "'") ||
			(state === "dq" && char === '"') ||
			(state === "tpl" && char === "`");
		index += 1;
		if (closes) {
			state = "code";
		}
	}
	return out.join("");
}

// SPEC §6.1 lexing: template-literal scanning shared by the pack enforcers.
// Split from health-lex.ts: template bodies blank as string content, but
// `${` holes hold code. Char-for-char, so every index maps to the original.
export type LexState = "code" | "line" | "block" | "sq" | "dq" | "tpl";

export interface LexScan {
	index: number;
	state: LexState;
	braceDepth: number;
	templateTops: Array<number>;
}

export function stepEscape(
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

// Brace depth tracks `${` holes: a `}` that returns to the depth a hole
// opened at closes the hole, so the template literal resumes. Stray
// closers floor at zero instead of opening a hole that never existed.
// Braces stay readable because code state never blanks.
export function stepCodeBrace(text: string, scan: LexScan): void {
	const char = text.charAt(scan.index);
	if (char === "{") {
		scan.braceDepth += 1;
		scan.index += 1;
		return;
	}
	if (char !== "}") {
		scan.index += 1;
		return;
	}
	scan.braceDepth -= 1;
	if (scan.braceDepth < 0) {
		scan.braceDepth = 0;
	}
	const top = scan.templateTops[scan.templateTops.length - 1];
	if (top !== undefined && scan.braceDepth === top) {
		scan.templateTops.pop();
		scan.state = "tpl";
	}
	scan.index += 1;
}

// Template bodies blank as string content, but `${` holes hold code:
// the opener stays so the hole reads as code, and the `}` that returns
// to the opening depth resumes the literal. The ts/lint unused-binding
// check counts words over blanked output, so a binding used only inside
// a hole would read as unused without this; it mirrors the TypeScript
// supply lexer (SPEC §6.1), so both blankCode implementations agree.
export function stepTemplate(
	text: string,
	out: Array<string>,
	scan: LexScan,
	blank: boolean,
): void {
	const char = text.charAt(scan.index);
	if (char === "\\") {
		stepEscape(text, out, scan, blank);
		return;
	}
	if (char === "$" && text.charAt(scan.index + 1) === "{") {
		scan.templateTops.push(scan.braceDepth);
		scan.braceDepth += 1;
		scan.state = "code";
		scan.index += 2;
		return;
	}
	if (char === "`") {
		if (blank) {
			out[scan.index] = " ";
		}
		scan.index += 1;
		scan.state = "code";
		return;
	}
	if (blank && char !== "\n") {
		out[scan.index] = " ";
	}
	scan.index += 1;
}

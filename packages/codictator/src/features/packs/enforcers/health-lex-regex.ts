// SPEC §6.1 lexing: regex-literal skipping for the pack blankers, over the
// shared detection in kernel/regex-literal.ts.
import { regexLiteralEnd } from "../../../kernel/index.ts";
import type { LexScan } from "./health-lex-template.ts";

// Step over one regex literal; its body blanks like string content, the
// delimiters stay. Returns false when the slash is not a regex start.
export function stepCodeRegex(
	text: string,
	out: Array<string>,
	scan: LexScan,
	blank: boolean,
): boolean {
	const end = regexLiteralEnd(text, scan.index);
	if (end === undefined) {
		return false;
	}
	if (blank) {
		for (let at = scan.index + 1; at < end; at += 1) {
			out[at] = " ";
		}
	}
	scan.index = end + 1;
	return true;
}

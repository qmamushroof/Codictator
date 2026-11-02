// SPEC §4.9.2: shared doc line vocabulary — the file/limit types plus
// the fence and line classifiers every doc check imports. Types and
// pure functions only; no runtime consts. Never touches the filesystem
// (SPEC §3.3, §10.3 item 3).
import { normalizeText } from "../../kernel/index.ts";

export interface DocFile {
	readonly path: string;
	readonly text: string;
}

export interface DocLimits {
	readonly maxBytes: number;
	readonly maxLines: number;
	readonly maxH2: number;
	readonly maxFilesPerFolder: number;
	readonly maxSentenceWords: number;
	readonly maxParagraphSentences: number;
}

export function isTableRow(line: string): boolean {
	return line.trimStart().startsWith("|");
}

export function isHeading(line: string): boolean {
	return /^#{1,6}\s/.test(line.trimStart());
}

export function isLinkOnlyLine(line: string): boolean {
	const stripped = line.trim();
	if (stripped === "") {
		return false;
	}
	const withoutLinks = stripped.replace(/!?\[.*?\]\(.*?\)/g, "").trim();
	// \x60 keeps the literal backtick out of the class: the pack lexer
	// has no regex awareness, so a backtick would hide later code.
	return withoutLinks.replace(/[*_~\x60|>\s-]/g, "") === "";
}

export function stripFences(text: string): string {
	return normalizeText(text)
		.split("\n")
		.filter((_, index, all) => {
			let fenced = false;
			for (let scan = 0; scan < index; scan += 1) {
				if (all[scan]?.trimStart().startsWith("```") === true) {
					fenced = !fenced;
				}
			}
			const line = all[index] ?? "";
			return !fenced && !line.trimStart().startsWith("```");
		})
		.join("\n");
}

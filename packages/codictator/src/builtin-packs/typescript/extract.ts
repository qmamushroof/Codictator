// SPEC §4.11.3 + §6.1: the TypeScript/JavaScript import extractor. A lexer,
// never the compiler API: the zero-deps rule for packages/codictator
// forbids the TypeScript compiler at runtime. Word primitives live in
// extract-words, quoted scanners in extract-literals and clause parsers in
// extract-clauses; this entry owns the single scan pass only.
import type { ImportExtractor, ImportRef } from "../../features/arch/index.ts";
import {
	parseExportAt,
	parseImportAt,
	parseRequireAt,
} from "./extract-clauses.ts";
import { skipAtom } from "./extract-literals.ts";
import { matchWordAt } from "./extract-words.ts";
import {
	lineAtIndex,
	lineStartsFor,
	TYPESCRIPT_SOURCE_EXTENSIONS,
	toPosixPath,
} from "./lex.ts";

// SPEC §4.11.3: lexes each source file in one pass; the scan order keeps
// the output deterministic without a later sort.
export function extractImports(
	fromPath: string,
	text: string,
): Array<ImportRef> {
	const from = toPosixPath(fromPath);
	const starts = lineStartsFor(text);
	const refs: Array<ImportRef> = [];
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		const next = text.charAt(index + 1);
		if (char === "/" && (next === "/" || next === "*")) {
			index = skipAtom(text, index);
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			index = skipAtom(text, index);
			continue;
		}
		if (matchWordAt(text, index, "import")) {
			const parsed = parseImportAt(text, index);
			if (parsed !== undefined) {
				refs.push({ from, to: parsed.spec, line: lineAtIndex(starts, index) });
				index = parsed.next;
				continue;
			}
		} else if (matchWordAt(text, index, "export")) {
			const parsed = parseExportAt(text, index);
			if (parsed !== undefined) {
				refs.push({ from, to: parsed.spec, line: lineAtIndex(starts, index) });
				index = parsed.next;
				continue;
			}
		} else if (matchWordAt(text, index, "require")) {
			const parsed = parseRequireAt(text, index);
			if (parsed !== undefined) {
				refs.push({ from, to: parsed.spec, line: lineAtIndex(starts, index) });
				index = parsed.next;
				continue;
			}
		}
		index += 1;
	}
	return refs;
}

// SPEC §3.4: the per-language extractor the arch graph consumes.
export function typescriptExtractor(): ImportExtractor {
	return {
		language: "typescript",
		extensions: [...TYPESCRIPT_SOURCE_EXTENSIONS],
		extract: (path: string, text: string): Array<ImportRef> =>
			extractImports(path, text),
	};
}

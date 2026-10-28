// SPEC §6.1 measures: function size by brace matching from `function`,
// method and arrow-body starts; cyclomatic as 1 plus the branch tokens;
// dead code as an exported name in a non-entry file with no importer. Later
// phases (arch, testing) consume these for `core/function-size`,
// `core/complexity` and `core/dead-code`.
import { extractImports, matchWordAt, skipTrivia } from "./extract.ts";
import { blankCode, lineAtIndex, lineStartsFor } from "./lex.ts";
import { isBareSpecifier, resolveRelativeSpecifier } from "./resolve.ts";

export interface FunctionSpan {
	readonly line: number;
	readonly lines: number;
}

// SPEC §6.1: 1 + `if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`
// and the ternary `?`. The ternary excludes `?.`, `??` and `?:` (optional
// members), so an optional parameter never counts as a branch.
export function measureCyclomatic(text: string): number {
	const code = blankCode(text);
	const words = code.match(/\b(if|for|while|case|catch)\b/g) ?? [];
	const ands = code.match(/&&/g) ?? [];
	const ors = code.match(/\|\|/g) ?? [];
	const nullish = code.match(/\?\?/g) ?? [];
	const withoutNullish = code.split("??").join("  ");
	const ternary = withoutNullish.match(/\?(?![?.:])/g) ?? [];
	return (
		1 +
		words.length +
		ands.length +
		ors.length +
		nullish.length +
		ternary.length
	);
}

function matchBrace(blanked: string, open: number): number {
	let depth = 0;
	for (let index = open; index < blanked.length; index += 1) {
		const char = blanked.charAt(index);
		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function nextBrace(blanked: string, index: number): number {
	const open = blanked.indexOf("{", index);
	return open;
}

// Method shorthand on one line: `name(...) {`, with async/static/get/set.
const METHOD_RE =
	/^[ \t]*(?:async[ \t]+)?(?:static[ \t]+)?(?:get[ \t]+|set[ \t]+)?[A-Za-z_$][\w$]*[ \t]*\([^();{}]*\)[ \t]*\{/gm;

function findStarts(blanked: string): Array<number> {
	const starts: Array<number> = [];
	const seen = new Set<number>();
	const push = (index: number): void => {
		if (!seen.has(index)) {
			seen.add(index);
			starts.push(index);
		}
	};
	for (const match of blanked.matchAll(/\bfunction\b|=>/g)) {
		const at = match.index ?? -1;
		if (at >= 0) {
			push(at);
		}
	}
	for (const match of blanked.matchAll(METHOD_RE)) {
		const at = match.index ?? -1;
		if (at >= 0) {
			push(at + match[0].lastIndexOf("{"));
		}
	}
	return starts.sort((a, b) => a - b);
}

function spanFromBrace(
	starts: ReadonlyArray<number>,
	blanked: string,
	from: number,
): FunctionSpan | undefined {
	const open = nextBrace(blanked, from);
	if (open < 0) {
		return undefined;
	}
	const close = matchBrace(blanked, open);
	if (close < 0) {
		return undefined;
	}
	const line = lineAtIndex(starts, from);
	return { line, lines: lineAtIndex(starts, close) - line + 1 };
}

function spanFromArrow(
	starts: ReadonlyArray<number>,
	blanked: string,
	text: string,
	arrow: number,
): FunctionSpan | undefined {
	const body = skipTrivia(text, arrow + 2);
	if (text.charAt(body) === "{") {
		return spanFromBrace(starts, blanked, arrow);
	}
	const line = lineAtIndex(starts, arrow);
	return { line, lines: 1 };
}

// Every span reports its definition line and length; nested functions report
// separately, so each body is judged on its own.
export function measureFunctionSizes(text: string): Array<FunctionSpan> {
	const blanked = blankCode(text);
	const starts = lineStartsFor(text);
	const spans: Array<FunctionSpan> = [];
	for (const from of findStarts(blanked)) {
		const word = blanked.slice(from, from + 8);
		let span: FunctionSpan | undefined;
		if (word.startsWith("=>")) {
			span = spanFromArrow(starts, blanked, text, from);
		} else if (word.startsWith("function")) {
			span = spanFromBrace(starts, blanked, from);
		} else {
			span = spanFromBrace(starts, blanked, from);
		}
		if (span !== undefined && span.lines > 0) {
			spans.push(span);
		}
	}
	return spans.sort((a, b) => a.line - b.line);
}

function namesFromBinding(fragment: string): Array<string> {
	const head = fragment.split("=", 1)[0] ?? "";
	const names: Array<string> = [];
	for (const match of head.matchAll(/[A-Za-z_$][\w$]*/g)) {
		const name = match[0];
		if (name !== "as" && name !== "type") {
			names.push(name);
		}
	}
	return names;
}

function namesFromList(fragment: string): Array<string> {
	const names: Array<string> = [];
	for (const part of fragment.split(",")) {
		const trimmed = part.trim();
		if (trimmed === "") {
			continue;
		}
		const asIndex = trimmed.search(/\bas\b/);
		const alias = asIndex >= 0 ? trimmed.slice(asIndex + 2).trim() : trimmed;
		const identifier = alias.match(/^[A-Za-z_$][\w$]*/);
		if (identifier !== null) {
			names.push(identifier[0]);
		}
	}
	return names;
}

// Locally defined names only; `export … from` re-exports belong to their
// origin file, and `export *` names nothing here.
export function findExportedNames(text: string): Array<string> {
	const code = blankCode(text);
	const names: Array<string> = [];
	const cursor = { index: 0 };
	while (cursor.index < code.length) {
		if (!matchWordAt(code, cursor.index, "export")) {
			cursor.index += 1;
			continue;
		}
		let next = skipTrivia(code, cursor.index + 6);
		if (matchWordAt(code, next, "type")) {
			next = skipTrivia(code, next + 4);
		}
		if (matchWordAt(code, next, "default")) {
			names.push("default");
			cursor.index = next + 7;
			continue;
		}
		if (code.charAt(next) === "{") {
			const close = code.indexOf("}", next);
			if (close < 0) {
				break;
			}
			const fromWord = code.slice(close, close + 8);
			if (matchWordAt(code, close + 1, "from") || fromWord.includes("from")) {
				cursor.index = close + 1;
				continue;
			}
			for (const name of namesFromList(code.slice(next + 1, close))) {
				names.push(name);
			}
			cursor.index = close + 1;
			continue;
		}
		if (code.charAt(next) === "*") {
			cursor.index = next + 1;
			continue;
		}
		const rest = code.slice(next, next + 40);
		const declared =
			/^(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?\s*|class\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/.exec(
				rest,
			);
		if (declared !== null) {
			const name = declared[1] ?? "";
			if (name !== "") {
				names.push(name);
			}
			cursor.index = next + declared[0].length;
			continue;
		}
		const binding = /^(?:declare\s+)?(?:const|let|var)\s*([{[].*?)[;=]/.exec(
			rest,
		);
		if (binding !== null) {
			for (const name of namesFromBinding(binding[1] ?? "")) {
				names.push(name);
			}
			cursor.index = next + binding[0].length;
			continue;
		}
		cursor.index = next + 1;
	}
	return [...new Set(names)].sort();
}

const CANDIDATE_EXTENSIONS: ReadonlyArray<string> = [
	"",
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
];

function resolveToFile(
	spec: string,
	from: string,
	known: ReadonlySet<string>,
): string | undefined {
	if (isBareSpecifier(spec)) {
		return undefined;
	}
	const base = resolveRelativeSpecifier(from, spec);
	for (const extension of CANDIDATE_EXTENSIONS) {
		const candidate = `${base}${extension}`;
		if (known.has(candidate)) {
			return candidate;
		}
	}
	for (const extension of CANDIDATE_EXTENSIONS.slice(1)) {
		const candidate = `${base}/index${extension}`;
		if (known.has(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

// A namespace or default import uses the module opaquely, so it counts as an
// importer of every name; named imports will refine this when the extractor
// carries binding names.
export function findDeadExports(
	files: Readonly<Record<string, string>>,
	isEntry: (path: string) => boolean,
): Array<{ readonly path: string; readonly name: string }> {
	const known = new Set(Object.keys(files));
	const imported = new Set<string>();
	for (const from of known) {
		const content = files[from] ?? "";
		for (const ref of extractImports(from, content)) {
			const target = resolveToFile(ref.to, from, known);
			if (target !== undefined) {
				imported.add(target);
			}
		}
	}
	const dead: Array<{ readonly path: string; readonly name: string }> = [];
	for (const path of [...known].sort()) {
		if (isEntry(path)) {
			continue;
		}
		if (imported.has(path)) {
			continue;
		}
		const content = files[path] ?? "";
		for (const name of findExportedNames(content)) {
			dead.push({ path, name });
		}
	}
	return dead;
}

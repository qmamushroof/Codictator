// SPEC §6.1 measures: dead code as an exported name in a non-entry file
// with no importer.
import { extractImports } from "./extract.ts";
import { matchWordAt, skipTrivia } from "./extract-words.ts";
import { blankCode } from "./lex.ts";
import { isBareSpecifier, resolveRelativeSpecifier } from "./resolve.ts";

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

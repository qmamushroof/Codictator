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

const DECLARATION =
	/^(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?\s*|class\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/;
const BINDING = /^(?:declare\s+)?(?:const|let|var)\s*([{[].*?)[;=]/;

// Reads `{ … }` after an export; returns the index to resume at, or -1 when
// the list never closes. `export { … } from` names nothing here.
export function readExportList(
	code: string,
	open: number,
	names: Array<string>,
): number {
	const close = code.indexOf("}", open);
	if (close < 0) {
		return -1;
	}
	const fromWord = code.slice(close, close + 8);
	if (matchWordAt(code, close + 1, "from") || fromWord.includes("from")) {
		return close + 1;
	}
	for (const name of namesFromList(code.slice(open + 1, close))) {
		names.push(name);
	}
	return close + 1;
}

function readDeclaration(
	code: string,
	next: number,
	names: Array<string>,
): number {
	const rest = code.slice(next, next + 40);
	const declared = DECLARATION.exec(rest);
	if (declared !== null) {
		const name = declared[1] ?? "";
		if (name !== "") {
			names.push(name);
		}
		return next + declared[0].length;
	}
	const binding = BINDING.exec(rest);
	if (binding === null) {
		return next + 1;
	}
	for (const name of namesFromBinding(binding[1] ?? "")) {
		names.push(name);
	}
	return next + binding[0].length;
}

// Reads one `export` at `index`; returns the index to resume at, or -1 to stop.
function readExport(code: string, index: number, names: Array<string>): number {
	let next = skipTrivia(code, index + 6);
	if (matchWordAt(code, next, "type")) {
		next = skipTrivia(code, next + 4);
	}
	if (matchWordAt(code, next, "default")) {
		names.push("default");
		return next + 7;
	}
	if (code.charAt(next) === "{") {
		return readExportList(code, next, names);
	}
	if (code.charAt(next) === "*") {
		return next + 1;
	}
	return readDeclaration(code, next, names);
}

// Locally defined names only; `export … from` re-exports belong to their
// origin file, and `export *` names nothing here.
export function findExportedNames(text: string): Array<string> {
	const code = blankCode(text);
	const names: Array<string> = [];
	let index = 0;
	while (index < code.length) {
		if (!matchWordAt(code, index, "export")) {
			index += 1;
			continue;
		}
		index = readExport(code, index, names);
		if (index < 0) {
			break;
		}
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

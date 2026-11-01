// SPEC §6.3 + §6.4 EC-8: the Python import extractor. A scanner, never the
// compiler API: the zero-deps rule for packages/codictator forbids running
// Python at check time. Covers `import a.b`, `from a import b` and relative
// levels, with backslash continuations; strings and comments never yield
// edges. A `from` edge reports the module after `from` with its leading
// dots, so `from . import local` reports "." and the resolver
// disambiguates it against the importing file. Namespace packages resolve
// by directory, never by marker file (EC-8).
export interface PythonImportRef {
	readonly from: string;
	readonly to: string;
	readonly line: number;
}

export interface PythonExtractor {
	readonly language: "python";
	readonly extensions: ReadonlyArray<string>;
	readonly extract: (from: string, text: string) => Array<PythonImportRef>;
}

// SPEC §6.3 file naming: `snake_case.py` sources plus `.pyi` stubs.
export const PYTHON_SOURCE_EXTENSIONS: ReadonlyArray<string> = [".py", ".pyi"];

export function isPythonFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return PYTHON_SOURCE_EXTENSIONS.some((extension) =>
		lowered.endsWith(extension),
	);
}

function toPosixPath(value: string): string {
	return value.split("\\").join("/");
}

function lineStartsFor(text: string): Array<number> {
	const starts = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text.charAt(index) === "\n") {
			starts.push(index + 1);
		}
	}
	return starts;
}

function lineAtIndex(starts: ReadonlyArray<number>, index: number): number {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if ((starts[mid] ?? 0) <= index) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return low + 1;
}

// Blank `count` chars to spaces, returning the index past the run.
function blankRun(out: Array<string>, index: number, count: number): number {
	for (let seen = 0; seen < count; seen += 1) {
		out[index] = " ";
		index += 1;
	}
	return index;
}

// Blank a quoted Python string from its opening quote char: the opening
// run, escapes and body to the closing run, keeping every newline. A
// single-quoted string unterminated on its line ends at the newline.
function blankPythonString(
	out: Array<string>,
	text: string,
	index: number,
	char: string,
): number {
	const triple =
		text.charAt(index + 1) === char && text.charAt(index + 2) === char;
	const quote = triple ? char.repeat(3) : char;
	index = blankRun(out, index, quote.length);
	while (index < text.length) {
		const next = text.charAt(index);
		if (next === "\\") {
			out[index] = " ";
			if (index + 1 < text.length && text.charAt(index + 1) !== "\n") {
				out[index + 1] = " ";
			}
			index += 2;
			continue;
		}
		if (!triple && next === "\n") {
			break;
		}
		if (text.startsWith(quote, index)) {
			index = blankRun(out, index, quote.length);
			break;
		}
		if (next !== "\n") {
			out[index] = " ";
		}
		index += 1;
	}
	return index;
}

// Blank Python strings and comments to spaces, keeping every newline so
// reported lines stay exact. Handles `#` comments, quoted and triple-quoted
// strings with prefixes (`r`, `b`, `f`, `u` in any case); an unterminated
// string blanks to the newline (single-quoted) or the end of text.
function blankPython(text: string): string {
	const out = text.split("");
	const length = text.length;
	let index = 0;
	while (index < length) {
		const char = text.charAt(index);
		if (char === "#") {
			while (index < length && text.charAt(index) !== "\n") {
				out[index] = " ";
				index += 1;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			index = blankPythonString(out, text, index, char);
			continue;
		}
		index += 1;
	}
	return out.join("");
}

// A gap inside an import statement: blanks, tabs, or a backslash line
// continuation. A bare newline never splits an import statement, so `raise
// X from err` followed later by an `import` line never reads as an edge.
const GAP = String.raw`(?:[ \t]|\\(?:\r\n|[\r\n]))+`;
const GAPZ = String.raw`(?:[ \t]|\\(?:\r\n|[\r\n]))*`;
const DOTTED = "[A-Za-z_][A-Za-z0-9_.]*";
const ALIAS = "[A-Za-z_][A-Za-z0-9_]*";
const FROM_PATTERN = new RegExp(
	`\\bfrom${GAP}(\\.*)(${DOTTED})?${GAP}import\\b`,
	"g",
);
const IMPORT_PATTERN = new RegExp(
	`\\bimport${GAP}(${DOTTED}(?:${GAP}as${GAP}${ALIAS})?(?:${GAPZ},${GAPZ}${DOTTED}(?:${GAP}as${GAP}${ALIAS})?)*)`,
	"g",
);

// SPEC §6.3: absolute `import a.b` and `from a import b` plus relative
// levels. One edge per dotted name; a `from` edge names the module after
// `from` with its leading dots, never the imported names.
export function extractPythonImports(
	from: string,
	text: string,
): Array<PythonImportRef> {
	const source = toPosixPath(from);
	const blanked = blankPython(text);
	const starts = lineStartsFor(blanked);
	const refs: Array<PythonImportRef> = [];
	const scan = new RegExp(
		`${FROM_PATTERN.source}|${IMPORT_PATTERN.source}`,
		"g",
	);
	for (let hit = scan.exec(blanked); hit !== null; hit = scan.exec(blanked)) {
		const line = lineAtIndex(starts, hit.index);
		if (hit[1] !== undefined || hit[2] !== undefined) {
			refs.push({ from: source, to: `${hit[1] ?? ""}${hit[2] ?? ""}`, line });
			continue;
		}
		const list = hit[3] ?? "";
		for (const part of list.split(",")) {
			const name = part.split(/\s+as\s+/)[0]?.trim() ?? "";
			if (name !== "") {
				refs.push({ from: source, to: name, line });
			}
		}
	}
	return refs;
}

// SPEC §6.4 EC-8: a namespace package without `__init__.py` resolves by
// directory, never by marker file. Absolute specifiers only; a leading dot
// (relative), an empty specifier or a non-identifier segment never
// resolves. Ties break toward the shallowest directory in sorted order,
// then the lexicographically first file, so the answer is deterministic.
export function resolvePythonModule(
	specifier: string,
	files: ReadonlyArray<string>,
): string | undefined {
	const trimmed = specifier.trim();
	if (trimmed === "" || trimmed.startsWith(".")) {
		return undefined;
	}
	const segments = trimmed.split(".");
	if (segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
		return undefined;
	}
	const relative = segments.join("/");
	const normalized = [...new Set(files.map(toPosixPath))].sort();
	const known = new Set(normalized);
	const dirs = new Set<string>([""]);
	for (const file of normalized) {
		const slash = file.lastIndexOf("/");
		let dir = slash < 0 ? "" : file.slice(0, slash);
		while (dir !== "") {
			dirs.add(dir);
			const parent = dir.lastIndexOf("/");
			dir = parent < 0 ? "" : dir.slice(0, parent);
		}
	}
	const at = (dir: string, rest: string): string =>
		dir === "" ? rest : `${dir}/${rest}`;
	for (const dir of [...dirs].sort()) {
		for (const extension of [".py", ".pyi"]) {
			const candidate = at(dir, `${relative}${extension}`);
			if (known.has(candidate)) {
				return candidate;
			}
		}
		for (const extension of [".py", ".pyi"]) {
			const candidate = at(dir, `${relative}/__init__${extension}`);
			if (known.has(candidate)) {
				return candidate;
			}
		}
	}
	for (const dir of [...dirs].sort()) {
		const prefix = `${at(dir, relative)}/`;
		const hit = normalized.find((file) => file.startsWith(prefix));
		if (hit !== undefined) {
			return hit;
		}
	}
	return undefined;
}

// SPEC §6.3: the extractor entry, shaped like the typescript extractor so
// the arch checks judge it by the same contract.
export function pythonExtractor(): PythonExtractor {
	return {
		language: "python",
		extensions: [...PYTHON_SOURCE_EXTENSIONS],
		extract: (path: string, text: string): Array<PythonImportRef> =>
			extractPythonImports(path, text),
	};
}

// SPEC §6.3: lexer-light Python supplies for the pack enforcers. The
// precise import extractor lives in builtin-packs/python; this module
// mirrors its blanking and statement scan locally because §3.3 forbids the
// packs module from importing the pack supplies (the same split as
// health-lex-imports.ts keeps for the typescript supply). Manifest-side
// mirrors (requirements pins, pyproject names) live in py-pins.ts.
export function isPythonFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return lowered.endsWith(".py") || lowered.endsWith(".pyi");
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
// reported lines stay exact. Local mirror of the extractor blanking (§3.3).
export function blankPythonCode(text: string): string {
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

export interface PythonSpecifier {
	readonly spec: string;
	readonly line: number;
}

const GAP = String.raw`(?:[ \t]|\\(?:\r\n|[\r\n]))+`;
const GAPZ = String.raw`(?:[ \t]|\\(?:\r\n|[\r\n]))*`;
const DOTTED = "[A-Za-z_][A-Za-z0-9_.]*";
const ALIAS = "[A-Za-z_][A-Za-z0-9_]*";
const SPEC_SCAN = new RegExp(
	`\\bfrom${GAP}(\\.*)(${DOTTED})?${GAP}import\\b|\\bimport${GAP}(${DOTTED}(?:${GAP}as${GAP}${ALIAS})?(?:${GAPZ},${GAPZ}${DOTTED}(?:${GAP}as${GAP}${ALIAS})?)*)`,
	"g",
);

function lineAtIndex(text: string, index: number): number {
	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (text.charAt(cursor) === "\n") {
			line += 1;
		}
	}
	return line;
}

// The imported modules of a file: one entry per dotted name, `from` edges
// carrying their leading dots. Local mirror of extractPythonImports (§3.3).
export function extractPythonSpecifiers(text: string): Array<PythonSpecifier> {
	const blanked = blankPythonCode(text);
	const found: Array<PythonSpecifier> = [];
	const scan = new RegExp(SPEC_SCAN.source, "g");
	for (let hit = scan.exec(blanked); hit !== null; hit = scan.exec(blanked)) {
		const line = lineAtIndex(blanked, hit.index);
		if (hit[1] !== undefined || hit[2] !== undefined) {
			found.push({ spec: `${hit[1] ?? ""}${hit[2] ?? ""}`, line });
			continue;
		}
		for (const part of (hit[3] ?? "").split(",")) {
			const name = part.split(/\s+as\s+/)[0]?.trim() ?? "";
			if (name !== "") {
				found.push({ spec: name, line });
			}
		}
	}
	return found;
}

export function isRelativePythonSpec(spec: string): boolean {
	return spec.startsWith(".");
}

// The top-level package of a dotted module: `os.path` rides on `os`, and
// a relative edge rides on the importing package, never a registry name.
export function pythonTopSegment(spec: string): string {
	const absolute = spec.replace(/^\.+/, "");
	return absolute.split(".", 1)[0] ?? "";
}

// SPEC §6.3 driver `pypi`: the standard-library top levels, mirrored here
// because §3.3 forbids importing the pack supply. Relative and stdlib
// imports are never phantom.
const PYTHON_STDLIB: ReadonlyArray<string> = [
	"__future__",
	"abc",
	"argparse",
	"ast",
	"asyncio",
	"base64",
	"builtins",
	"collections",
	"concurrent",
	"configparser",
	"contextlib",
	"contextvars",
	"copy",
	"csv",
	"ctypes",
	"dataclasses",
	"datetime",
	"decimal",
	"difflib",
	"dis",
	"email",
	"enum",
	"errno",
	"faulthandler",
	"fnmatch",
	"fractions",
	"functools",
	"gc",
	"getpass",
	"gettext",
	"glob",
	"gzip",
	"hashlib",
	"heapq",
	"hmac",
	"html",
	"http",
	"idlelib",
	"importlib",
	"inspect",
	"io",
	"ipaddress",
	"itertools",
	"json",
	"keyword",
	"lib2to3",
	"linecache",
	"locale",
	"logging",
	"lzma",
	"mailbox",
	"marshal",
	"math",
	"mimetypes",
	"mmap",
	"multiprocessing",
	"numbers",
	"operator",
	"os",
	"pathlib",
	"pdb",
	"pickle",
	"pickletools",
	"pkgutil",
	"platform",
	"plistlib",
	"pprint",
	"profile",
	"pstats",
	"pty",
	"pwd",
	"py_compile",
	"pyclbr",
	"pydoc",
	"queue",
	"quopri",
	"random",
	"re",
	"readline",
	"reprlib",
	"resource",
	"rlcompleter",
	"runpy",
	"sched",
	"secrets",
	"select",
	"selectors",
	"shelve",
	"shlex",
	"shutil",
	"signal",
	"site",
	"smtpd",
	"smtplib",
	"socket",
	"socketserver",
	"sqlite3",
	"ssl",
	"stat",
	"statistics",
	"string",
	"stringprep",
	"struct",
	"subprocess",
	"symtable",
	"sys",
	"sysconfig",
	"tabnanny",
	"tarfile",
	"telnetlib",
	"tempfile",
	"termios",
	"textwrap",
	"threading",
	"time",
	"timeit",
	"tkinter",
	"token",
	"tokenize",
	"tomllib",
	"trace",
	"traceback",
	"tracemalloc",
	"tty",
	"turtle",
	"turtledemo",
	"types",
	"typing",
	"unicodedata",
	"unittest",
	"urllib",
	"uu",
	"uuid",
	"venv",
	"warnings",
	"wave",
	"weakref",
	"webbrowser",
	"wsgiref",
	"xdrlib",
	"xml",
	"xmlrpc",
	"zipapp",
	"zipfile",
	"zipimport",
	"zlib",
	"zoneinfo",
];

export function isPythonStdlib(top: string): boolean {
	return PYTHON_STDLIB.includes(top);
}

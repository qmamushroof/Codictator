// SPEC §4.7.2 + §4.7.3: where the shell text of a scanned file lives: the
// whole file for a shell script, `run:` steps for anything else, and the
// object-syntax lines of a source file that are code, not shell.
import { isTsFile } from "./health-measures.ts";
import { isPythonFile } from "./py-lex.ts";
import { unquoteScalar } from "./yaml-scalars.ts";

const SCRIPT_EXTENSIONS: ReadonlyArray<string> = [
	".sh",
	".bash",
	".zsh",
	".ksh",
	".ps1",
	".cmd",
	".bat",
];

function isScriptFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return SCRIPT_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

// SPEC §4.7.2 + §4.7.3: in a programming-language source file the text after
// a marker word can be object syntax, not a shell command or a write target.
// Only the three shapes that triggered BUG-0094 are skipped, and only in a
// TypeScript, JavaScript or Python file: a bare opener before a multi-line
// arrow, an arrow-function head (a parameter list or one identifier, then
// `=>`), and a member call written with no space before its paren. Anything else, and every other file (workflow YAML, scripts,
// markdown, extension-less), stays judged, so the rules fail closed
// (SPEC §4.7.2: an unparseable or ambiguous input blocks).
const CODE_OPENER = /^[([{]$/;
// A parameter list (identifier characters, commas, spaces and `= . : ? [ ]`
// only) or one identifier (optionally async) before the arrow.
const CODE_ARROW =
	/^(?:async\s+)?(?:[A-Za-z_$][\w$]*|\([\w, =.:?[\]]*\))\s*=>$/;
const CODE_CALL = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^|&><`{]*$/;
const SHELL_SUBST = "$(";

function isSourceFile(path: string): boolean {
	return isTsFile(path) || isPythonFile(path);
}

export function isCodeShape(text: string, file: string): boolean {
	if (!isSourceFile(file)) {
		return false;
	}
	return (
		CODE_OPENER.test(text) ||
		CODE_ARROW.test(text) ||
		(CODE_CALL.test(text) &&
			!text.includes(SHELL_SUBST) &&
			!text.slice(0, -1).includes(";"))
	);
}

const NEWLINE = String.fromCharCode(10);
// An unbalanced quote: analyseShell fails closed (CDX-E306) on it, so a
// `run:` value that cannot be read is reported unparseable, never skipped.
const UNREADABLE = "'";
const BLOCK_INDICATOR = /^([|>])[+-]?\d?[+-]?(?:\s+#.*)?$/;
const LIST_DASHES = /^(?:-[ \t]+)*/;
const RUN_KEY = /^(?:run|"run"|'run')[ \t]*:/i;
const FLOW_RUN = /^{.*["']?\brun\b["']?[ \t]*:/i;
const NODE_PROPERTIES = /^(?:[&!]\S*[ \t]+)+/;

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

interface RunKey {
	readonly column: number;
	readonly rest: string;
	readonly flow: boolean;
}

// The `run` key of a line, past any list dashes (spaces or tabs), with its
// column. A flow mapping holding a run key is flagged, not parsed.
function runKey(line: string): RunKey | undefined {
	const lead = indentOf(line);
	const text = line.trimStart();
	const dashes = LIST_DASHES.exec(text)?.[0] ?? "";
	const body = text.slice(dashes.length);
	if (FLOW_RUN.test(body)) {
		return { column: lead, rest: "", flow: true };
	}
	const key = RUN_KEY.exec(body);
	if (key === null) {
		return undefined;
	}
	return {
		column: lead + dashes.length,
		rest: body.slice(key[0].length).trim().replace(NODE_PROPERTIES, ""),
		flow: false,
	};
}

// The body of a block scalar: blank lines and lines indented past the key,
// dedented to the first body line, without trailing blank lines.
function blockBody(
	lines: ReadonlyArray<string>,
	from: number,
	column: number,
	dedent = true,
): { readonly body: Array<string>; readonly next: number } {
	const body: Array<string> = [];
	let next = from;
	while (next < lines.length) {
		const line = (lines[next] ?? "").replace(/\r$/, "");
		if (line.trim() !== "" && indentOf(line) <= column) {
			break;
		}
		body.push(line);
		next += 1;
	}
	while (body.length > 0 && (body[body.length - 1] ?? "").trim() === "") {
		body.pop();
	}
	// A plain scalar keeps every character of a later line: its lines may
	// indent less than the first, so only a block scalar strips a base, and
	// never more than its shallowest line (an indent digit such as `|2` lets
	// the first line sit deeper than the rest).
	const indents = body
		.filter((line) => line.trim() !== "")
		.map((line) => indentOf(line));
	const base = indents.length === 0 || !dedent ? 0 : Math.min(...indents);
	return { body: body.map((line) => line.slice(base)), next };
}

// A literal block keeps its lines; a folded block joins consecutive lines
// with a space and turns a blank line into one line break. In a folded
// block scalar a more-indented line is never folded: it keeps its breaks.
function joinBlock(
	folded: boolean,
	body: ReadonlyArray<string>,
	block = false,
): string {
	if (!folded) {
		return body.join(NEWLINE);
	}
	const groups: Array<string> = [];
	let current: Array<string> = [];
	for (const line of body) {
		if (block && /^\s+\S/.test(line)) {
			groups.push(current.join(" "), line.trim());
			current = [];
		} else if (line.trim() === "") {
			groups.push(current.join(" "));
			current = [];
		} else {
			current.push(line.trim());
		}
	}
	groups.push(current.join(" "));
	return groups.filter((group) => group !== "").join(NEWLINE);
}

const MAPPING_ENTRY = /^[A-Za-z_][\w.-]*\s*:(?:\s|$)/;

// The text of a plain scalar that starts on the key line (or the next one):
// continuation lines indented past the key fold into it, full-line comments
// drop out (YAML never reads them as part of the scalar), and an empty key
// line followed by a `key:` entry is a mapping, not a command.
function plainSources(
	lines: ReadonlyArray<string>,
	index: number,
	key: RunKey,
): { readonly sources: Array<string>; readonly last: number } {
	const taken = blockBody(lines, index + 1, key.column, false);
	const body = taken.body.filter((line) => !line.trim().startsWith("#"));
	const first = body.find((line) => line.trim() !== "") ?? "";
	if (key.rest === "" && MAPPING_ENTRY.test(first.trim())) {
		return { sources: [], last: index };
	}
	const text = joinBlock(true, key.rest === "" ? body : [key.rest, ...body]);
	return { sources: [text], last: taken.next - 1 };
}

// The shell source of one `run:` step whose key sits at `index`, or none.
// Returns the sources it yields and the index of the last line it consumed.
function stepSources(
	lines: ReadonlyArray<string>,
	index: number,
	key: RunKey,
	path: string,
): { readonly sources: Array<string>; readonly last: number } {
	if (key.flow) {
		return { sources: [UNREADABLE], last: index };
	}
	const block = BLOCK_INDICATOR.exec(key.rest);
	if (block !== null) {
		const taken = blockBody(lines, index + 1, key.column);
		const text = joinBlock(block[1] === ">", taken.body, true);
		return { sources: [text], last: taken.next - 1 };
	}
	if (key.rest.startsWith("'") || key.rest.startsWith('"')) {
		return { sources: [unquoteScalar(key.rest) ?? UNREADABLE], last: index };
	}
	if (!isSourceFile(path)) {
		return plainSources(lines, index, key);
	}
	const inline = key.rest !== "" && !isCodeShape(key.rest, path);
	return { sources: inline ? [key.rest] : [], last: index };
}

// SPEC §4.7.2: one shell source per `run:` step (plain, quoted or block
// scalar text, past list dashes, anchors, tags and a quoted or spaced key),
// or the whole file for a shell script. A flow mapping, an undecodable
// quoted value and a multi-line quoted value fail closed as unparseable;
// other files carry no shell text, so they yield nothing.
export function extractShellSources(
	content: string,
	path: string,
): Array<string> {
	if (isScriptFile(path)) {
		return content.length === 0 ? [] : [content];
	}
	const sources: Array<string> = [];
	const lines = content.split(NEWLINE);
	for (let index = 0; index < lines.length; index += 1) {
		const key = runKey(lines[index] ?? "");
		if (key === undefined) {
			continue;
		}
		const step = stepSources(lines, index, key, path);
		sources.push(...step.sources.filter((source) => source.trim() !== ""));
		index = step.last;
	}
	return sources;
}

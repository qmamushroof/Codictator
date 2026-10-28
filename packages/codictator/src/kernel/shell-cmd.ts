// SPEC §4.7.2: command elaboration for the shell analyser. Prefixes
// (env assignments, sudo, env, command, nohup, time) strip before analysis;
// keywords recurse into their arguments; xargs resolves to its target;
// sh -c/pwsh -Command/cmd /c/eval keep their script for the deny matcher.
import type { SimpleCommand } from "./shell.ts";

export function commandName(command: SimpleCommand): string {
	return command.name.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

export function nonFlagArgs(command: SimpleCommand): Array<string> {
	const kept: Array<string> = [];
	let index = 0;
	const argv = command.argv;
	while (index < argv.length) {
		const word = argv[index];
		if (word === undefined) {
			break;
		}
		if (word === "--") {
			kept.push(...argv.slice(index + 1));
			break;
		}
		if (word.startsWith("-") && word !== "-") {
			index += 1;
			continue;
		}
		kept.push(word);
		index += 1;
	}
	return kept;
}

export const SCRIPT_NAMES = new Set([
	"sh",
	"bash",
	"dash",
	"zsh",
	"ksh",
	"pwsh",
	"powershell",
]);

const STRIP_NAMES = new Set(["env", "command", "nohup", "time"]);

const KEYWORDS = new Set([
	"if",
	"then",
	"elif",
	"else",
	"fi",
	"for",
	"while",
	"until",
	"do",
	"done",
	"case",
	"esac",
	"select",
	"in",
	"function",
	"coproc",
	"time",
]);

const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const FUNCTION_HEAD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/;

export function baseName(word: string): string {
	const slashed = word.replace(/\\/g, "/");
	const last = slashed.lastIndexOf("/");
	const bare = last < 0 ? slashed : slashed.slice(last + 1);
	return bare.endsWith(".exe") ? bare.slice(0, -4) : bare;
}

function skipFlagValues(
	words: ReadonlyArray<string>,
	valueFlags: ReadonlySet<string>,
): Array<string> {
	const kept: Array<string> = [];
	let index = 0;
	while (index < words.length) {
		const word = words[index];
		if (word === undefined) {
			break;
		}
		if (word === "--") {
			kept.push(...words.slice(index + 1));
			break;
		}
		if (word.startsWith("-") && word !== "-") {
			if (valueFlags.has(word.toLowerCase())) {
				index += 2;
				continue;
			}
			index += 1;
			continue;
		}
		kept.push(word);
		index += 1;
	}
	return kept;
}

interface Stripped {
	readonly rest: ReadonlyArray<string>;
	readonly raised: boolean;
	readonly scripts: ReadonlyArray<string>;
	readonly bare: boolean;
}

function stripPrefixes(words: ReadonlyArray<string>): Stripped {
	let rest = [...words];
	let raised = false;
	const scripts: Array<string> = [];
	while (rest.length > 0) {
		const head = rest[0];
		if (head === undefined) {
			break;
		}
		if (ASSIGNMENT_PATTERN.test(head)) {
			rest = rest.slice(1);
			continue;
		}
		const lowered = baseName(head).toLowerCase();
		if (lowered === "sudo" || lowered === "su") {
			raised = true;
			rest = skipFlagValues(
				rest.slice(1),
				new Set(["-u", "--user", "-g", "--group"]),
			);
			if (rest.length > 0 && (rest[0] === "-c" || rest[0] === "--command")) {
				const script = rest[1];
				if (script !== undefined) {
					scripts.push(script);
				}
				return { rest: [], raised, scripts, bare: true };
			}
			continue;
		}
		if (STRIP_NAMES.has(lowered)) {
			rest = skipFlagValues(rest.slice(1), new Set());
			continue;
		}
		break;
	}
	return { rest, raised, scripts, bare: false };
}

function scriptFlagIndex(rest: ReadonlyArray<string>, lowered: string): number {
	if (!SCRIPT_NAMES.has(lowered) && lowered !== "cmd") {
		return -1;
	}
	return rest.findIndex(
		(word) =>
			word === "-c" ||
			word === "--command" ||
			word.toLowerCase() === "-command" ||
			word === "/c" ||
			word === "/C",
	);
}

function buildStripped(
	pipeline: Array<SimpleCommand>,
	raw: string,
	rest: ReadonlyArray<string>,
	raised: boolean,
	scripts: ReadonlyArray<string>,
	descend: (inner: string) => void,
): void {
	if (rest.length === 0) {
		return;
	}
	const name = rest[0];
	if (name === undefined || name.startsWith("-")) {
		return;
	}
	const lowered = baseName(name).toLowerCase();
	if (KEYWORDS.has(lowered)) {
		if (rest.length > 1) {
			descend(rest.slice(1).join(" "));
		}
		return;
	}
	if (lowered === "xargs") {
		const target = skipFlagValues(
			rest.slice(1),
			new Set(["-i", "-n", "-p", "-s", "-l", "-a"]),
		);
		if (target.length > 0) {
			buildShellCommand(pipeline, target, raw, raised, scripts, descend);
		}
		return;
	}
	const extra =
		lowered === "eval" && rest.length > 1 ? [rest.slice(1).join(" ")] : [];
	const at = scriptFlagIndex(rest, lowered);
	const single = rest[at + 1];
	const joined = rest.slice(at + 1).join(" ");
	const embedded =
		at >= 0
			? [
					...scripts,
					...(SCRIPT_NAMES.has(lowered)
						? single === undefined || single === ""
							? []
							: [single]
						: [joined]),
				]
			: [...scripts, ...extra];
	pipeline.push({
		name,
		argv: rest.slice(1),
		raw,
		elevated: raised,
		embedded,
	});
}

// SPEC §4.7.2: one parsed word list becomes one simple command, with
// prefixes stripped and embedded scripts collected for the deny matcher.
export function buildShellCommand(
	pipeline: Array<SimpleCommand>,
	words: ReadonlyArray<string>,
	raw: string,
	raised: boolean,
	scripts: ReadonlyArray<string>,
	descend: (inner: string) => void,
): void {
	if (words.every((word) => FUNCTION_HEAD_PATTERN.test(word))) {
		return;
	}
	const stripped = stripPrefixes(words);
	const totalRaised = raised || stripped.raised;
	const totalScripts = [...scripts, ...stripped.scripts];
	if (stripped.bare) {
		pipeline.push({
			name: "su",
			argv: [],
			raw,
			elevated: totalRaised,
			embedded: totalScripts,
		});
		return;
	}
	buildStripped(
		pipeline,
		raw,
		stripped.rest,
		totalRaised,
		totalScripts,
		descend,
	);
}

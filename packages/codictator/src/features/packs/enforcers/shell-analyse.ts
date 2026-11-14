// SPEC §4.7.2 core/dangerous-shell: the kernel shell analyser bound to
// the rule. Shell text arrives as `run:` lines of the scanned files (the
// hook runtime feeds tool commands this way); whole files with a shell
// extension are analysed as scripts. Findings carry the rule id the
// self-test asserts (CDX-E212/E213).
import {
	analyseShell,
	matchDangerousShell,
	type Ports,
	redactSecrets,
} from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { isTsFile } from "./health-measures.ts";
import { plainEnforcer } from "./plain-enforcer.ts";
import { isPythonFile } from "./py-lex.ts";

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
// arrow, an arrow-function head (a parameter list or one identifier, then `=>`), and a member call written with no space before its
// paren. Anything else, and every other file (workflow YAML, scripts,
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

// SPEC §4.7.2: one shell source per `run:` line, or the whole file for a
// shell script. Other files carry no shell text, so they yield nothing.
export function extractShellSources(
	content: string,
	path: string,
): Array<string> {
	if (isScriptFile(path)) {
		return content.length === 0 ? [] : [content];
	}
	const sources: Array<string> = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trimStart();
		if (trimmed.toLowerCase().startsWith("run:")) {
			const command = trimmed.slice("run:".length).trim();
			if (command !== "" && !isCodeShape(command, path)) {
				sources.push(command);
			}
		}
	}
	return sources;
}

// SPEC §4.7.2: the L1 hook scope carries the shell command text itself.
// An unparseable command blocks CDX-E306 fail-closed; every deny-class
// match blocks with the command redacted, like the file sources below.
function checkHookCommand(
	binding: RuleBinding,
	scope: CheckContext["scope"],
): Array<Finding> {
	const findings: Array<Finding> = [];
	const command = scope.shellCommand;
	if (command === undefined || command === "") {
		return findings;
	}
	const parsed = analyseShell(command);
	if (!parsed.ok) {
		findings.push(
			findingFor(binding, {
				code: parsed.error.code,
				message: "shell command in tool input is unparseable",
				vars: { path: "tool input" },
			}),
		);
		return findings;
	}
	for (const violation of matchDangerousShell(parsed.value)) {
		findings.push(
			findingFor(binding, {
				message: `${violation.detail} in tool input: ${redactSecrets(violation.raw)}`,
				vars: { path: "tool input" },
			}),
		);
	}
	return findings;
}

export function resolveDangerousShell(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) {
	return plainEnforcer(decl, rule, (binding) => async (ctx) => {
		const findings: Array<Finding> = checkHookCommand(binding, ctx.scope);
		for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
			const loaded = await readLossyText(ports.fs, file);
			if (!loaded.ok) {
				findings.push(readErrorFinding(binding, file, loaded.error, "read"));
				continue;
			}
			for (const source of extractShellSources(loaded.value.text, file)) {
				const parsed = analyseShell(source);
				if (!parsed.ok) {
					findings.push(
						findingFor(binding, {
							path: file,
							code: parsed.error.code,
							message: `shell command in ${file} is unparseable`,
							vars: { path: file },
						}),
					);
					continue;
				}
				for (const violation of matchDangerousShell(parsed.value)) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `${violation.detail} in ${file}: ${redactSecrets(violation.raw)}`,
							vars: { path: file },
						}),
					);
				}
			}
		}
		return findings;
	});
}

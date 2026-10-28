// SPEC §4.7.2: the deny classes over a ShellAnalysis. Destruction outside
// the repo, remote code, privilege, credential exfiltration and history
// destruction each yield a violation; the bypass class is owned by §4.14.3
// and lands with integrity. Per-command checks own shell-deny-cmd.ts;
// structural rules (pipes, embedded scripts) live here. Matching is
// conservative by design: a false positive is remediated in the rule with
// a passing fixture, never waived.
import { isSecretReadPath } from "./secret-paths.ts";
import type { ShellAnalysis, ShellPipeline, SimpleCommand } from "./shell.ts";
import { commandName } from "./shell-cmd.ts";
import { dispatchToolCheck, flag, readsSecret } from "./shell-deny-cmd.ts";
import { analyseShell } from "./shell-scan.ts";

export type ShellViolationClass =
	| "destruction"
	| "remote-code"
	| "privilege"
	| "exfiltration"
	| "secret-read"
	| "history-destruction"
	| "unparseable";

export interface ShellViolation {
	readonly class: ShellViolationClass;
	readonly raw: string;
	readonly detail: string;
}

const ALWAYS_BLOCK = new Set([
	"mkfs",
	"diskpart",
	"shred",
	"vssadmin",
	"bcdedit",
	"takeown",
]);
const SHELL_NAMES = new Set([
	"sh",
	"bash",
	"dash",
	"zsh",
	"ksh",
	"python",
	"python3",
	"perl",
	"ruby",
	"php",
	"node",
	"powershell",
	"pwsh",
]);
const NETWORK_TOOLS = new Set([
	"curl",
	"wget",
	"ssh",
	"scp",
	"sftp",
	"ftp",
	"nc",
	"ncat",
	"telnet",
	"iwr",
	"invoke-webrequest",
]);
const DOWNLOADS = new Set([
	"curl",
	"wget",
	"iwr",
	"invoke-webrequest",
	"aria2c",
]);
const URL_PATTERN = /^(?:https?|ftp):\/\//i;

function hasUrl(command: SimpleCommand): boolean {
	return command.argv.some((word) => URL_PATTERN.test(word));
}

function embeddedAnalysis(command: SimpleCommand): Array<ShellAnalysis> {
	const found: Array<ShellAnalysis> = [];
	for (const script of command.embedded) {
		const parsed = analyseShell(script);
		if (parsed.ok) {
			found.push(parsed.value);
		}
	}
	return found;
}

function embeddedHasDownload(command: SimpleCommand): boolean {
	for (const analysis of embeddedAnalysis(command)) {
		for (const pipeline of analysis.pipelines) {
			for (const inner of pipeline.commands) {
				const name = commandName(inner);
				if (DOWNLOADS.has(name) && hasUrl(inner)) {
					return true;
				}
			}
		}
	}
	return false;
}

function checkCommand(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const name = commandName(command);
	if (command.elevated) {
		flag(out, "privilege", command.raw, "privilege escalation with sudo or su");
	}
	if (ALWAYS_BLOCK.has(name)) {
		flag(
			out,
			name === "takeown" ? "privilege" : "destruction",
			command.raw,
			`destructive tool ${name}`,
		);
		return;
	}
	if (
		name === "cipher" &&
		command.argv.some((word) => word.toLowerCase() === "/w")
	) {
		flag(out, "destruction", command.raw, "cipher /w destroys free space");
		return;
	}
	dispatchToolCheck(command, out);
	if (readsSecret(command)) {
		flag(
			out,
			"secret-read",
			command.raw,
			"shell command reads secret material",
		);
	}
	const shellLike =
		SHELL_NAMES.has(name) ||
		name === "eval" ||
		name === "iex" ||
		name === "invoke-expression";
	if (shellLike && embeddedHasDownload(command)) {
		flag(out, "remote-code", command.raw, "shell executes downloaded content");
	}
	if (
		(name === "iex" || name === "invoke-expression") &&
		embeddedHasDownload(command)
	) {
		flag(out, "remote-code", command.raw, "expression of downloaded content");
	}
}

function checkPipeline(
	pipeline: ShellPipeline,
	found: Array<ShellViolation>,
): void {
	for (let index = 0; index < pipeline.commands.length - 1; index += 1) {
		const current = pipeline.commands[index];
		const next = pipeline.commands[index + 1];
		if (current === undefined || next === undefined) {
			continue;
		}
		pipeStep(pipeline, index, current, next, found);
	}
}

function pipeStep(
	pipeline: ShellPipeline,
	index: number,
	current: SimpleCommand,
	next: SimpleCommand,
	found: Array<ShellViolation>,
): void {
	const currentName = commandName(current);
	const nextName = commandName(next);
	if (
		DOWNLOADS.has(currentName) &&
		hasUrl(current) &&
		SHELL_NAMES.has(nextName)
	) {
		flag(
			found,
			"remote-code",
			`${current.raw} | ${next.raw}`,
			"download piped into a shell",
		);
	}
	if (SHELL_NAMES.has(nextName) && !pipedDownload(pipeline, index)) {
		flag(
			found,
			"remote-code",
			`${current.raw} | ${next.raw}`,
			"pipe into a shell executes its input",
		);
	}
	if (readsSecret(current) && NETWORK_TOOLS.has(nextName)) {
		flag(
			found,
			"exfiltration",
			`${current.raw} | ${next.raw}`,
			"secret material piped to a network tool",
		);
	}
}

function pipedDownload(pipeline: ShellPipeline, index: number): boolean {
	return pipeline.commands
		.slice(0, index + 1)
		.some((entry) => DOWNLOADS.has(commandName(entry)) && hasUrl(entry));
}

// SPEC §4.7.2 deny classes: destruction, remote code, privilege, credential
// exfiltration and history destruction. A download piped into a shell, a
// secret read piped to a network tool, and a shell executing downloaded
// content all block; the analyser stays conservative by design.
export function matchDangerousShell(
	analysis: ShellAnalysis,
): Array<ShellViolation> {
	const found: Array<ShellViolation> = [];
	const visit = (current: ShellAnalysis): void => {
		for (const pipeline of current.pipelines) {
			for (const command of pipeline.commands) {
				checkCommand(command, found);
				for (const script of command.embedded) {
					const parsed = analyseShell(script);
					if (!parsed.ok) {
						flag(
							found,
							"unparseable",
							command.raw,
							"embedded shell is unparseable",
						);
						continue;
					}
					visit(parsed.value);
				}
			}
			checkPipeline(pipeline, found);
		}
		for (const input of current.inputs) {
			if (isSecretReadPath(input)) {
				flag(found, "secret-read", `< ${input}`, "shell reads secret material");
			}
		}
	};
	visit(analysis);
	return found;
}

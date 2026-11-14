// SPEC §4.7.2: per-command deny checks for the shell analyser. Behaviour
// lives in shell-deny-target (target classification), shell-deny-destroy
// (destructive commands) and shell-deny-escalate (privilege, history and
// secret reads); this file re-exports the surface and owns the one command
// family, one deny class dispatch so existing imports keep working.
import type { SimpleCommand } from "./shell.ts";
import { commandName } from "./shell-cmd.ts";
import type { ShellViolation } from "./shell-deny.ts";
import {
	checkDd,
	checkDel,
	checkFormat,
	checkRemoveItem,
	checkRm,
} from "./shell-deny-destroy.ts";
import { checkChmod, checkGh, checkGit } from "./shell-deny-escalate.ts";
import { classifyTarget, flag, type TargetKind } from "./shell-deny-target.ts";
import { analyseShell } from "./shell-scan.ts";

export {
	checkChmod,
	checkGh,
	checkGit,
	readsSecret,
	secretReadTargets,
} from "./shell-deny-escalate.ts";
export {
	checkDd,
	checkDel,
	checkFormat,
	checkRemoveItem,
	checkRm,
	classifyTarget,
	flag,
	type TargetKind,
};

// SPEC §4.7.2: one command family, one deny class. Destruction, privilege
// and history destruction match here.
export function dispatchToolCheck(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const name = commandName(command);
	if (name === "rm") {
		checkRm(command, out);
	} else if (name === "remove-item" || name === "ri" || name === "rmdir") {
		checkRemoveItem(command, out);
	} else if (name === "del" || name === "erase" || name === "rd") {
		checkDel(command, out);
	} else if (name === "chmod" || name === "chown") {
		checkChmod(command, out);
	} else if (name === "dd") {
		checkDd(command, out);
	} else if (name === "git") {
		checkGit(command, out);
	} else if (name === "gh") {
		checkGh(command, out);
	} else if (name === "format") {
		checkFormat(command, out);
	}
}

const INLINE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["node", new Set(["-e", "--eval", "-p", "--print"])],
	["python", new Set(["-c"])],
	["python3", new Set(["-c"])],
	["perl", new Set(["-e", "-E"])],
	["ruby", new Set(["-e"])],
	["php", new Set(["-r"])],
	["sh", new Set(["-c"])],
	["bash", new Set(["-c"])],
	["dash", new Set(["-c"])],
	["zsh", new Set(["-c"])],
	["ksh", new Set(["-c"])],
	["pwsh", new Set(["-c", "-command"])],
	["powershell", new Set(["-c", "-command"])],
]);

const SHELL_PROGRAMS: ReadonlySet<string> = new Set([
	"sh",
	"bash",
	"dash",
	"zsh",
	"ksh",
	"pwsh",
	"powershell",
]);

// An inline shell program that itself runs a bare interpreter hands the
// piped data to it, so the data still executes. Unparseable fails closed.
function programReadsStdin(program: string): boolean {
	const parsed = analyseShell(program);
	if (!parsed.ok) {
		return true;
	}
	return parsed.value.pipelines.some((pipeline) =>
		pipeline.commands.some(
			(inner) =>
				INLINE_FLAGS.has(commandName(inner)) && !hasInlineProgram(inner),
		),
	);
}

// SPEC §4.7.2: an interpreter given an inline program runs that program;
// what is piped into it is data (an inline shell program is judged as an
// embedded script, and must not itself read stdin as a program).
export function hasInlineProgram(command: SimpleCommand): boolean {
	const name = commandName(command);
	const flags = INLINE_FLAGS.get(name);
	if (flags === undefined) {
		return false;
	}
	const at = command.argv.findIndex((word) => flags.has(word.toLowerCase()));
	const program = command.argv[at + 1];
	if (at < 0 || program === undefined || program === "-") {
		return false;
	}
	return !SHELL_PROGRAMS.has(name) || !programReadsStdin(program);
}

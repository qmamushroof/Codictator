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

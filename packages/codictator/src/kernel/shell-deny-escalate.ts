// SPEC §4.7.2: privilege, history-destruction and secret-read deny checks
// for the shell analyser. Destruction checks own shell-deny-destroy.ts;
// the target classification owns shell-deny-target.ts.
import { isSecretReadPath } from "./secret-paths.ts";
import type { SimpleCommand } from "./shell.ts";
import { commandName, nonFlagArgs } from "./shell-cmd.ts";
import type { ShellViolation } from "./shell-deny.ts";
import { classifyTarget, flag } from "./shell-deny-target.ts";

function chmodRiskyFlags(command: SimpleCommand): boolean {
	const recursive = command.argv.some(
		(word) =>
			word === "--recursive" ||
			(word.startsWith("-") && !word.startsWith("--") && word.includes("R")),
	);
	const mode777 = command.argv.some(
		(word) => word === "777" || word === "0777" || word === "a+rwx",
	);
	return recursive || mode777;
}

function chmodOutsideTarget(command: SimpleCommand): boolean {
	const targets = nonFlagArgs(command).filter(
		(word) =>
			!/^[0-7]{3,4}$/.test(word) && !word.includes("=") && !word.includes(","),
	);
	return targets.some((target) => classifyTarget(target) !== "inside");
}

export function checkChmod(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	if (chmodRiskyFlags(command) || chmodOutsideTarget(command)) {
		flag(
			out,
			"privilege",
			command.raw,
			"permission change outside safe bounds",
		);
	}
}

const PROTECTED_BRANCHES = new Set(["main", "master", "trunk", "develop"]);

function gitForceTarget(
	command: SimpleCommand,
	args: ReadonlyArray<string>,
): boolean {
	const forced = command.argv.some(
		(word) =>
			word === "--force" || word === "--force-with-lease" || word === "-f",
	);
	if (!forced) {
		return false;
	}
	const branches = args.slice(1).flatMap((word) => {
		const colon = word.lastIndexOf(":");
		return colon < 0 ? [word] : [word.slice(colon + 1)];
	});
	const blocked = branches.find(
		(branch) =>
			PROTECTED_BRANCHES.has(branch) ||
			branch.startsWith("release/") ||
			branch === "HEAD",
	);
	return blocked !== undefined || branches.length === 0;
}

export function checkGit(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const args = nonFlagArgs(command).filter((word) => !word.includes("="));
	const subcommand = args[0] ?? "";
	if (subcommand === "filter-branch" || subcommand === "filter-repo") {
		flag(out, "history-destruction", command.raw, "history rewrite");
		return;
	}
	if (subcommand === "update-ref" && args.includes("-d")) {
		flag(out, "history-destruction", command.raw, "ref deletion");
		return;
	}
	if (subcommand === "reflog" && args.includes("expire")) {
		flag(out, "history-destruction", command.raw, "reflog expiry");
		return;
	}
	if (subcommand !== "push") {
		return;
	}
	if (gitForceTarget(command, args)) {
		flag(
			out,
			"history-destruction",
			command.raw,
			"force push to a protected branch or an unknown target",
		);
	}
}

export function checkGh(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const args = nonFlagArgs(command);
	if ((args[0] === "repo" || args[0] === "release") && args[1] === "delete") {
		flag(out, "history-destruction", command.raw, "remote deletion");
	}
}

export function secretReadTargets(command: SimpleCommand): Array<string> {
	return nonFlagArgs(command).filter((word) => isSecretReadPath(word));
}

const READERS = new Set([
	"cat",
	"less",
	"more",
	"head",
	"tail",
	"grep",
	"sed",
	"awk",
	"get-content",
	"gc",
	"type",
	"bat",
	"strings",
	"xxd",
	"od",
]);

// SPEC §4.7.2 credential exfiltration: bare env/printenv/set print secrets
// into the context; reader commands print the secret paths they are given.
export function readsSecret(command: SimpleCommand): boolean {
	const name = commandName(command);
	if (name === "env" || name === "printenv" || name === "set") {
		return command.argv.length === 0;
	}
	if (!READERS.has(name)) {
		return false;
	}
	return secretReadTargets(command).length > 0;
}

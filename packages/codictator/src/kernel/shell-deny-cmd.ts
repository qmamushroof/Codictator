// SPEC §4.7.2: per-command deny checks for the shell analyser. Each
// checker matches one command family against its deny class; the
// structural rules (pipes, embedded scripts) own shell-deny.ts.
import { isSecretReadPath } from "./secret-paths.ts";
import type { SimpleCommand } from "./shell.ts";
import { commandName, nonFlagArgs } from "./shell-cmd.ts";
import type { ShellViolation } from "./shell-deny.ts";

type TargetKind = "inside" | "outside" | "root";

function isHomeRoot(slashed: string): boolean {
	const bracedHome = "$" + "{HOME}";
	return (
		slashed === "~" ||
		slashed.startsWith("~/") ||
		slashed === "$HOME" ||
		slashed.startsWith("$HOME/") ||
		slashed === bracedHome ||
		slashed.startsWith(`${bracedHome}/`) ||
		slashed === "%USERPROFILE%" ||
		slashed.startsWith("%USERPROFILE%/")
	);
}

function classifyTarget(target: string): TargetKind {
	if (target === "" || target === "-") {
		return "inside";
	}
	const slashed = target.replace(/\\/g, "/");
	if (isHomeRoot(slashed)) {
		return "root";
	}
	const drive = /^[A-Za-z]:(\/|$)/.exec(slashed);
	if (drive !== null) {
		const rest = slashed.slice(2);
		return rest === "" || rest === "/" ? "root" : "outside";
	}
	if (slashed.startsWith("/") || slashed.startsWith("//")) {
		return slashed === "/" ? "root" : "outside";
	}
	const kept: Array<string> = [];
	for (const part of slashed.split("/")) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			if (kept.pop() === undefined) {
				return "outside";
			}
			continue;
		}
		kept.push(part);
	}
	return "inside";
}

export function flag(
	out: Array<ShellViolation>,
	className: ShellViolation["class"],
	raw: string,
	detail: string,
): void {
	out.push({ class: className, raw, detail });
}

function rmTargets(command: SimpleCommand): Array<string> {
	return nonFlagArgs(command).filter((word) => word !== "-");
}

function checkRm(command: SimpleCommand, out: Array<ShellViolation>): void {
	const recursive = command.argv.some(
		(word) =>
			word === "--recursive" ||
			(word.startsWith("-") &&
				!word.startsWith("--") &&
				(word.includes("r") || word.includes("R"))),
	);
	const targets = rmTargets(command);
	if (recursive) {
		const bad = targets.find((target) => classifyTarget(target) !== "inside");
		if (bad !== undefined || targets.length === 0) {
			flag(
				out,
				"destruction",
				command.raw,
				"recursive remove outside the repo root",
			);
		}
		return;
	}
	const bad = targets.find((target) => classifyTarget(target) === "root");
	if (bad !== undefined) {
		flag(out, "destruction", command.raw, "remove of a filesystem root");
	}
}

function checkRemoveItem(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const recursive = command.argv.some(
		(word) => word === "-r" || word.toLowerCase().startsWith("-rec"),
	);
	const targets = nonFlagArgs(command);
	if (recursive) {
		const bad = targets.find((target) => classifyTarget(target) !== "inside");
		if (bad !== undefined || targets.length === 0) {
			flag(
				out,
				"destruction",
				command.raw,
				"recursive remove outside the repo root",
			);
		}
		return;
	}
	const bad = targets.find((target) => classifyTarget(target) === "root");
	if (bad !== undefined) {
		flag(out, "destruction", command.raw, "remove of a drive root");
	}
}

function checkDel(command: SimpleCommand, out: Array<ShellViolation>): void {
	const recursive =
		commandName(command) === "rd" &&
		command.argv.some((word) => word.toLowerCase().startsWith("/s"));
	const targets = command.argv.filter(
		(word) => !word.startsWith("/") && !word.startsWith("-"),
	);
	if (recursive) {
		const bad = targets.find((target) => classifyTarget(target) !== "inside");
		if (bad !== undefined || targets.length === 0) {
			flag(
				out,
				"destruction",
				command.raw,
				"recursive remove outside the repo root",
			);
		}
		return;
	}
	const bad = targets.find((target) => classifyTarget(target) !== "inside");
	if (bad !== undefined) {
		flag(out, "destruction", command.raw, "remove outside the repo root");
	}
}

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

function checkChmod(command: SimpleCommand, out: Array<ShellViolation>): void {
	if (chmodRiskyFlags(command) || chmodOutsideTarget(command)) {
		flag(
			out,
			"privilege",
			command.raw,
			"permission change outside safe bounds",
		);
	}
}

function checkDd(command: SimpleCommand, out: Array<ShellViolation>): void {
	const output = command.argv.find((word) => word.startsWith("of="));
	if (output === undefined) {
		return;
	}
	const target = output.slice("of=".length);
	if (target.startsWith("/dev/")) {
		flag(out, "destruction", command.raw, "direct write to a device");
	}
}

function checkFormat(command: SimpleCommand, out: Array<ShellViolation>): void {
	const targets = command.argv.filter((word) => !word.startsWith("/"));
	const bad = targets.find((target) => classifyTarget(target) !== "inside");
	if (bad !== undefined || targets.length === 0) {
		flag(out, "destruction", command.raw, "drive format");
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

function checkGit(command: SimpleCommand, out: Array<ShellViolation>): void {
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

function checkGh(command: SimpleCommand, out: Array<ShellViolation>): void {
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

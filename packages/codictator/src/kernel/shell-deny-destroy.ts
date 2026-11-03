// SPEC §4.7.2: destruction deny checks for the shell analyser. Each
// checker matches one destructive command family (removal, device writes,
// drive formats) against the target classification; privilege and history
// checks own shell-deny-escalate.ts.
import type { SimpleCommand } from "./shell.ts";
import { commandName, nonFlagArgs } from "./shell-cmd.ts";
import type { ShellViolation } from "./shell-deny.ts";
import { classifyTarget, flag } from "./shell-deny-target.ts";

function rmTargets(command: SimpleCommand): Array<string> {
	return nonFlagArgs(command).filter((word) => word !== "-");
}

export function checkRm(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
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

export function checkRemoveItem(
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

export function checkDel(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
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

export function checkDd(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const output = command.argv.find((word) => word.startsWith("of="));
	if (output === undefined) {
		return;
	}
	const target = output.slice("of=".length);
	if (target.startsWith("/dev/")) {
		flag(out, "destruction", command.raw, "direct write to a device");
	}
}

export function checkFormat(
	command: SimpleCommand,
	out: Array<ShellViolation>,
): void {
	const targets = command.argv.filter((word) => !word.startsWith("/"));
	const bad = targets.find((target) => classifyTarget(target) !== "inside");
	if (bad !== undefined || targets.length === 0) {
		flag(out, "destruction", command.raw, "drive format");
	}
}

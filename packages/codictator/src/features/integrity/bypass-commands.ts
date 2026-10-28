// SPEC §4.14.3 command table: the bypass shapes matched against each
// parsed command. Pure over kernel shell types; the caller collects the
// commands so wrappers (bash -c, env, $(…)) are analysed, not trusted.
import type { SimpleCommand } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";

export const NO_BYPASS = "core/no-bypass";

// SPEC §4.19.2 human-only commands: blocked for agents by the shell guard.
const HUMAN_ONLY = new Set([
	"init",
	"uninstall",
	"waive",
	"pack accept",
	"task ack",
	"baseline capture",
]);

function normalizePath(path: string): string {
	const forward = path.replaceAll("\\", "/");
	return forward.startsWith("./") ? forward.slice(2) : forward;
}

// SPEC §4.14.3 target rows: every generated state path plus the generated
// CI workflow. Harness config files are entries-mode (drift, EC-6), so user
// additions there stay allowed and are not protected here.
export function isProtectedPath(path: string): boolean {
	const target = normalizePath(path);
	if (target === ".codictator" || target.startsWith(".codictator/")) {
		return true;
	}
	if (target === ".githooks" || target.startsWith(".githooks/")) {
		return true;
	}
	if (target === ".husky" || target.startsWith(".husky/")) {
		return true;
	}
	return (
		target.startsWith(".github/workflows/codictator") &&
		(target.endsWith(".yml") || target.endsWith(".yaml"))
	);
}

export function noBypass(message: string, remediation: string): Finding {
	return { ruleId: NO_BYPASS, message, remediation };
}

function matchGit(cmd: SimpleCommand): string | undefined {
	if (cmd.name !== "git") {
		return undefined;
	}
	const args = cmd.argv;
	if (args[0] === "-c" && args[1]?.includes("core.hooksPath") === true) {
		return "git -c core.hooksPath overrides the installed hooks";
	}
	if (args[0] === "config" && args.some((a) => a.includes("core.hooksPath"))) {
		return "git config core.hooksPath moves hooks away from the installed dir";
	}
	if (
		args[0] === "commit" &&
		args.some((a) => a === "-n" || a === "--no-verify")
	) {
		return "git commit --no-verify skips the pre-commit and commit-msg gates";
	}
	if (args[0] === "push" && args.includes("--no-verify")) {
		return "git push --no-verify skips the pre-push gate";
	}
	if (args[0] === "rm" && args.some((a) => isProtectedPath(a))) {
		return "git rm on a protected guardrail path";
	}
	return undefined;
}

function matchDestructive(cmd: SimpleCommand): string | undefined {
	if (
		cmd.name === "chmod" &&
		cmd.argv.includes("-x") &&
		cmd.argv.some(
			(a) =>
				a === ".githooks" ||
				a.startsWith(".githooks/") ||
				a.startsWith(".husky/"),
		)
	) {
		return "chmod -x on hooks disables the git gates";
	}
	if (
		(cmd.name === "rm" || cmd.name === "mv") &&
		cmd.argv.some((a) => isProtectedPath(a))
	) {
		return `${cmd.name} on a protected guardrail path`;
	}
	return undefined;
}

function matchHost(cmd: SimpleCommand): string | undefined {
	if (cmd.name !== "gh") {
		return undefined;
	}
	const args = cmd.argv;
	if (args[0] === "workflow" && args[1] === "disable") {
		return "gh workflow disable turns off the merge gate";
	}
	if (
		args[0] === "api" &&
		args.some((a) => /rules|protection|rulesets/.test(a))
	) {
		const flagAt = args.findIndex((a) => a === "-X" || a === "--method");
		const method = flagAt >= 0 ? args[flagAt + 1] : undefined;
		if (method !== undefined && method !== "GET") {
			return "gh api writes to branch protection or rulesets";
		}
	}
	return undefined;
}

function matchNpm(cmd: SimpleCommand): string | undefined {
	if (
		cmd.name === "npm" &&
		["uninstall", "remove", "un", "rm"].includes(cmd.argv[0] ?? "") &&
		cmd.argv.some((a) => a === "codictator")
	) {
		return "npm uninstall codictator removes the engine the gates run on";
	}
	return undefined;
}

function matchHumanOnly(cmd: SimpleCommand): string | undefined {
	const at = cmd.argv.findIndex(
		(a) => a === "codictator" || a.endsWith("/codictator"),
	);
	const base =
		at >= 0
			? cmd.argv.slice(at + 1)
			: cmd.name === "codictator"
				? cmd.argv
				: [];
	if (base.length === 0) {
		return undefined;
	}
	const head = `${base[0]}${base[1] === undefined ? "" : ` ${base[1]}`}`;
	if (HUMAN_ONLY.has(base[0] ?? "") || HUMAN_ONLY.has(head)) {
		return `human-only codictator command \`${head}\` invoked by an agent`;
	}
	return undefined;
}

export function matchCommand(cmd: SimpleCommand): string | undefined {
	return (
		matchGit(cmd) ??
		matchDestructive(cmd) ??
		matchHost(cmd) ??
		matchNpm(cmd) ??
		matchHumanOnly(cmd)
	);
}

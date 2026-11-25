// SPEC §4.14.3 self-protection detectors: the bypass command table, the
// raw-text backstop and the guardrail path table. The detectors live in the
// kernel so every module judges the same shapes without importing a feature
// module (§3.3; the security/index.ts pattern). Shaping findings stays with
// the callers: integrity for direct checks, packs for the live enforcer.
import type { SimpleCommand } from "./shell.ts";
import { analyseShell } from "./shell-scan.ts";

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

// SPEC §4.12.4 + §4.14.3 Paths row: the round's findings file
// `.codictator/reviews/<task-id>-r<round>.json`, written by the fresh
// reviewer, with `round` a positive integer. With a task id the file must
// be that task's; without one any well-formed task id matches.
const FINDINGS_FILE = /^\.codictator\/reviews\/(T-\d+)-r([1-9]\d*)\.json$/;

export function isReviewFindingsPath(path: string, taskId?: string): boolean {
	const match = FINDINGS_FILE.exec(normalizePath(path));
	return match !== null && (taskId === undefined || match[1] === taskId);
}

function matchGitHooksPath(args: ReadonlyArray<string>): string | undefined {
	if (args[0] === "-c" && args[1]?.includes("core.hooksPath") === true) {
		return "git -c core.hooksPath overrides the installed hooks";
	}
	if (args[0] === "config" && args.some((a) => a.includes("core.hooksPath"))) {
		return "git config core.hooksPath moves hooks away from the installed dir";
	}
	return undefined;
}

function matchGitNoVerify(args: ReadonlyArray<string>): string | undefined {
	if (
		args[0] === "commit" &&
		args.some((a) => a === "-n" || a === "--no-verify")
	) {
		return "git commit --no-verify skips the pre-commit and commit-msg gates";
	}
	if (args[0] === "push" && args.includes("--no-verify")) {
		return "git push --no-verify skips the pre-push gate";
	}
	return undefined;
}

function matchGitRm(args: ReadonlyArray<string>): string | undefined {
	if (args[0] === "rm" && args.some((a) => isProtectedPath(a))) {
		return "git rm on a protected guardrail path";
	}
	return undefined;
}

function matchGit(cmd: SimpleCommand): string | undefined {
	if (cmd.name !== "git") {
		return undefined;
	}
	return (
		matchGitHooksPath(cmd.argv) ??
		matchGitNoVerify(cmd.argv) ??
		matchGitRm(cmd.argv)
	);
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

// SPEC §4.14.3: package-manager verbs that remove a dependency.
const REMOVE_VERBS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["npm", new Set(["uninstall", "remove", "un", "rm", "r", "unlink"])],
	["pnpm", new Set(["remove", "rm", "uninstall", "un"])],
	["yarn", new Set(["remove"])],
	["bun", new Set(["remove", "rm"])],
]);

function matchPackageRemove(cmd: SimpleCommand): string | undefined {
	const verb = cmd.argv[0] ?? "";
	if (
		REMOVE_VERBS.get(cmd.name)?.has(verb) === true &&
		cmd.argv.some((a) => a === "codictator" || a.startsWith("codictator@"))
	) {
		return `${cmd.name} ${verb} codictator removes the engine the gates run on`;
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

// SPEC §4.14.3 command table: the bypass shapes matched against each
// parsed command. The caller collects the commands so wrappers (bash -c,
// env, $(…)) are analysed, not trusted.
function matchBypassCommand(cmd: SimpleCommand): string | undefined {
	return (
		matchGit(cmd) ??
		matchDestructive(cmd) ??
		matchHost(cmd) ??
		matchPackageRemove(cmd) ??
		matchHumanOnly(cmd)
	);
}

// The first bypass hit across the candidate shell texts, parsed in order;
// unparseable candidates are skipped here and the caller blocks them
// fail-closed instead of allowing.
export function firstBypassHit(
	candidates: ReadonlyArray<string>,
): string | undefined {
	for (const candidate of candidates) {
		const parsed = analyseShell(candidate);
		if (!parsed.ok) {
			continue;
		}
		for (const pipeline of parsed.value.pipelines) {
			for (const cmd of pipeline.commands) {
				const hit = matchBypassCommand(cmd);
				if (hit !== undefined) {
					return hit;
				}
			}
		}
	}
	return undefined;
}

// SPEC §4.7.2 backstop: raw tokens catch bypass shapes the structured parse
// missed; parse failure alone never becomes an allow.
export function scanBypassRawText(text: string): string | undefined {
	const lowered = ` ${text.toLowerCase()} `;
	if (lowered.includes("--no-verify")) {
		return "raw --no-verify flag bypasses the git gates";
	}
	if (/(^|\s)git\s.*\scommit\s.*\s-n(\s|$)/.test(`${text} `)) {
		return "raw git commit -n bypasses the git gates";
	}
	if (lowered.includes("core.hookspath")) {
		return "raw core.hooksPath override moves hooks away from the installed dir";
	}
	if (
		/(^|\s)husky=0(\s|;|$)/.test(lowered) ||
		/(^|\s)skip=[^\s]+/.test(lowered)
	) {
		return "raw HUSKY=0/SKIP= assignment disables the hooks";
	}
	if (lowered.includes("workflow disable")) {
		return "raw workflow disable turns off the merge gate";
	}
	return undefined;
}

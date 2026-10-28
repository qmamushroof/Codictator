// SPEC §4.14.3: self-protection (L1, core/no-bypass). Commands are matched
// by the kernel shell analyser, so wrappers (bash -c, env assignments,
// $(…) nesting) do not hide them; a raw token scan backstops unparseable
// input fail-closed. There is no flag or file that turns Codictator off.
import { analyseShell, parseJson } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";
import { isProtectedPath, matchCommand, noBypass } from "./bypass-commands.ts";

export { isProtectedPath };

const TOOL_WRITE_VERBS = new Set([
	"write",
	"edit",
	"create",
	"delete",
	"remove",
	"move",
	"rename",
	"rm",
	"unlink",
]);

const SHELLS = new Set(["bash", "sh", "dash", "zsh", "env", "sudo", "doas"]);

// SPEC §4.7.2 backstop: raw tokens catch bypass shapes the structured parse
// missed; parse failure alone never becomes an allow.
function rawBypassScan(text: string): string | undefined {
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

function candidatesFor(command: ReadonlyArray<string>): Array<string> {
	const out = [command.join(" ")];
	for (let i = 0; i + 1 < command.length; i += 1) {
		const flag = command[i];
		const next = command[i + 1];
		if ((flag === "-c" || flag === "--command") && next !== undefined) {
			out.push(next);
		}
	}
	if (
		command.length > 1 &&
		SHELLS.has(command[0] ?? "") &&
		!command.includes("-c")
	) {
		out.push(command.slice(1).join(" "));
	}
	return out;
}

function codictatorDep(text: string): string | undefined {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return undefined;
	}
	const root: unknown = parsed.value;
	if (
		typeof root !== "object" ||
		root === null ||
		!("devDependencies" in root)
	) {
		return undefined;
	}
	const deps: unknown = root.devDependencies;
	if (typeof deps !== "object" || deps === null || !("codictator" in deps)) {
		return undefined;
	}
	const pinned: unknown = deps.codictator;
	return typeof pinned === "string" ? pinned : undefined;
}

// SPEC §4.14.3 manifests row: a package.json write that removes or changes
// the codictator dev dependency is self-protection, not drift.
export function checkPackageManifestEdit(
	beforeText: string,
	afterText: string,
): Array<Finding> {
	const before = codictatorDep(beforeText);
	const after = codictatorDep(afterText);
	if (before !== undefined && after !== before) {
		return [
			noBypass(
				"package.json removes or changes the codictator dev dependency",
				"Restore the exact pinned codictator devDependency; upgrades go through the upgrade bot (§4.8.6).",
			),
		];
	}
	return [];
}

export interface CommitInRange {
	readonly sha: string;
	readonly message: string;
	readonly author: string;
	readonly isMerge: boolean;
}

// SPEC §4.14.2 core/no-bypass at L4: a non-merge commit in range needs the
// Codictator-L3 trailer that commit-msg adds (value: short config hash),
// unless its author is exempt (bot accounts). Web-editor commits (EC-4) and
// --no-verify commits (EC-3) lack it and block the PR here.
export function checkCommitTrailers(
	commits: ReadonlyArray<CommitInRange>,
	trailerExempt: ReadonlyArray<string>,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const commit of commits) {
		if (commit.isMerge || trailerExempt.includes(commit.author)) {
			continue;
		}
		if (
			!commit.message
				.split("\n")
				.some((line) => line.startsWith("Codictator-L3: "))
		) {
			findings.push(
				noBypass(
					`commit ${commit.sha} lacks the Codictator-L3 trailer`,
					"Make the change locally so commit-msg adds the trailer; web-editor commits must be redone locally (EC-4).",
				),
			);
		}
	}
	return findings;
}

function toolFormHit(command: ReadonlyArray<string>): Finding | undefined {
	const verb = (command[0] ?? "").toLowerCase();
	if (!TOOL_WRITE_VERBS.has(verb)) {
		return undefined;
	}
	const target = command.find((part) => isProtectedPath(part));
	if (target === undefined) {
		return undefined;
	}
	return noBypass(
		`agent ${verb} of protected guardrail path ${target}`,
		"All guardrail state changes go through `codictator` commands (§4.14.5); run `codictator regen` instead.",
	);
}

function unparseableFinding(): Finding {
	return {
		ruleId: "core/dangerous-shell",
		code: "CDX-E306",
		message: "shell command is unparseable; blocking fail-closed",
		remediation: "Rewrite the command with balanced quotes and retry (§4.7.2).",
	};
}

// SPEC §4.14.2 + §4.14.3: L1 blocks the bypass; L4 blocks the PR via the
// missing Codictator-L3 trailer. Every hit names the blocked construct.
export function checkSelfProtection(
	_ctx: CheckContext,
	command: ReadonlyArray<string>,
): Array<Finding> {
	const toolHit = toolFormHit(command);
	if (toolHit !== undefined) {
		return [toolHit];
	}
	const candidates = candidatesFor(command);
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const parsed = analyseShell(candidate);
		if (!parsed.ok) {
			continue;
		}
		for (const pipeline of parsed.value.pipelines) {
			for (const cmd of pipeline.commands) {
				const hit = matchCommand(cmd);
				if (hit !== undefined && !seen.has(hit)) {
					seen.add(hit);
					return [
						noBypass(
							hit,
							"Run the command without the bypass; hooks and required checks cannot be skipped (§4.14.3).",
						),
					];
				}
			}
		}
	}
	const raw = rawBypassScan(candidates[0] ?? "");
	if (raw !== undefined) {
		return [
			noBypass(
				raw,
				"Wrappers do not hide bypasses from the shell analyser; run the command without the bypass (§4.14.3).",
			),
		];
	}
	const failed = candidates.some((candidate) => !analyseShell(candidate).ok);
	const looksShell =
		SHELLS.has(command[0] ?? "") || /[;|&$`()]/.test(candidates[0] ?? "");
	if (failed && looksShell) {
		return [unparseableFinding()];
	}
	return [];
}

// SPEC §4.12.3 L1: a write is blocked with no active task, when the
// phase does not allow that file class, or outside files.allow. The message
// names the phase and the command to move on or amend the plan.
import { globMatch } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import type { ChangeClass, TaskRecord } from "./tasks.ts";

// SPEC §4.12.3 L1: a write is blocked with no active task, when the phase
// does not allow that file class, or outside files.allow. The message
// names the phase and the command to move on or amend the plan.
export interface WriteCheckOptions {
	readonly changeClass?: ChangeClass;
	readonly bot?: boolean;
}

function isDocPath(path: string): boolean {
	return path.startsWith("docs/") || path.endsWith(".md");
}

export function isTestPath(path: string): boolean {
	return (
		path.includes("/tests/") ||
		path.startsWith("tests/") ||
		path.includes(".test.")
	);
}

function isHistoryPath(path: string): boolean {
	return path.startsWith("docs/HISTORY/") || path.startsWith("docs/BUGS/");
}

function inAllow(path: string, allow: ReadonlyArray<string>): boolean {
	return allow.some((glob) => globMatch(glob, path));
}

const FIXED_OWNED = new Set(["package.json", "package-lock.json", ".nvmrc"]);
const OWNED_DIRS = [".codictator/", ".githooks/", ".husky/"];

// The literal part of a plan entry before its first wildcard.
function literalPrefix(path: string): string {
	const at = path.search(/[*?[{]/);
	return at < 0 ? path : path.slice(0, at);
}

// SPEC §4.14.1 manifest-owned: the fixed set, or a path (or a plan glob with
// a literal prefix) that matches a path the manifest lists. A bare wildcard
// has no prefix and never counts, so `**` or `*.json` stay code.
function isManifestOwned(
	path: string,
	manifestPaths: ReadonlyArray<string>,
): boolean {
	if (FIXED_OWNED.has(path) || OWNED_DIRS.some((dir) => path.startsWith(dir))) {
		return true;
	}
	return (
		literalPrefix(path) !== "" &&
		manifestPaths.some((listed) => globMatch(path, listed))
	);
}

// SPEC §4.12.2 change classes: manifests and lockfiles alone are deps and
// need no task file; manifest-owned files alone run as guardrail.
export function classifyChange(
	files: ReadonlyArray<string>,
	manifestPaths: ReadonlyArray<string> = [],
): ChangeClass {
	if (files.length === 0) {
		return "code";
	}
	if (files.every((path) => isManifestOwned(path, manifestPaths))) {
		return "chore";
	}
	if (files.every((path) => isDocPath(path))) {
		return "docs";
	}
	return "code";
}

export async function checkWriteWithinPlan(
	task: TaskRecord | undefined,
	files: ReadonlyArray<string>,
	phase: string,
	options: WriteCheckOptions = {},
): Promise<Array<Finding>> {
	const changeClass = options.changeClass ?? classifyChange(files);
	// SPEC §4.12.7 EC-12: deps class (manifests and lockfiles only) and bot
	// dependency PRs owe no task file.
	if (
		changeClass === "deps" ||
		(options.bot === true && changeClass !== "code")
	) {
		return [];
	}
	if (task === undefined) {
		return [
			{
				ruleId: "core/workflow-gates",
				message: "write with no active task on this branch",
				remediation:
					"Run codictator task new --type <type> --title ... to open the branch task.",
			},
		];
	}
	if (changeClass === "chore" || changeClass === "guardrail") {
		return [];
	}
	const findings: Array<Finding> = [];
	const allowedKind = (path: string): boolean => {
		// SPEC §4.12.7 EC-11: docs-only changes stay allowed in a code task.
		if (isDocPath(path)) {
			return true;
		}
		switch (phase) {
			case "discovery":
			case "planning": {
				return isTestPath(path);
			}
			case "implementation":
			case "validation": {
				return inAllow(path, task.files.allow);
			}
			case "record": {
				return isHistoryPath(path);
			}
			default: {
				return false;
			}
		}
	};
	for (const path of [...files].sort()) {
		if (!allowedKind(path)) {
			const remediation =
				phase === "review" || phase === "integrate"
					? "Return to implementation to change code; the change voids proofs and review."
					: "Run codictator task amend --allow <glob> to widen the plan; new tests return the task to planning.";
			findings.push({
				ruleId: "core/writes-within-plan",
				path,
				message: `write to ${path} is outside phase ${phase}`,
				remediation,
			});
		}
	}
	return findings;
}

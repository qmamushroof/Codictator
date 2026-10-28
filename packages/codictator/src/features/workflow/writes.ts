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

function isTestPath(path: string): boolean {
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

// SPEC §4.12.2 change classes: manifests and lockfiles alone are deps and
// need no task file; manifest-owned files alone run as guardrail.
export function classifyChange(files: ReadonlyArray<string>): ChangeClass {
	if (files.length === 0) {
		return "code";
	}
	const manifestOwned = (path: string): boolean =>
		path === "package.json" ||
		path === "package-lock.json" ||
		path === ".nvmrc" ||
		path.startsWith(".codictator/") ||
		path.startsWith(".githooks/") ||
		path.startsWith(".husky/");
	if (files.every((path) => manifestOwned(path))) {
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

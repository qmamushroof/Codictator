// SPEC §4.9.4: the task-level bug checks — a fix names an existing row and
// carries its diagnosis before implementation. Pure over caller-supplied
// rows; regression-test existence arrives from the Fs port at the enforcer
// layer, never from here.
import type { Finding } from "../engine/index.ts";
import type { BugRow } from "./bug-grammar.ts";

export interface TaskRef {
	readonly type: string;
	readonly bug: string | undefined;
	readonly diagnosis: string | undefined;
}

// SPEC §4.9.4 core/bug-registry: a fix names an existing row, and after the
// commit that row is fixed with a regression test whose path exists.
export function checkBugRegistry(
	task: TaskRef,
	rows: ReadonlyArray<BugRow>,
	regressionExists: (path: string) => boolean,
	path: string,
): Array<Finding> {
	if (task.type !== "fix") {
		return [];
	}
	if (task.bug === undefined || task.bug === "") {
		return [
			{
				ruleId: "core/bug-registry",
				path,
				message: "fix task names no bug row",
				remediation: `Name the registry row in the history entry Bug field, e.g. Bug: BUG-0001, and fix that row in ${path}.`,
			},
		];
	}
	const row = rows.find((entry) => entry.id === task.bug);
	if (row === undefined) {
		return [
			{
				ruleId: "core/bug-registry",
				path,
				message: `fix task names unknown bug row ${task.bug}`,
				remediation: `Add the ${task.bug} row to ${path} first, or name the existing row the fix covers.`,
			},
		];
	}
	if (row.status !== "fixed") {
		return [
			{
				ruleId: "core/bug-registry",
				path,
				message: `fix task row ${task.bug} is ${row.status}, want fixed`,
				remediation: `Move ${task.bug} to fixed in ${path} with its Fix cell and regression test.`,
			},
		];
	}
	if (row.regressionTest === "" || !regressionExists(row.regressionTest)) {
		return [
			{
				ruleId: "core/bug-registry",
				path,
				message: `fix task row ${task.bug} names a missing regression test`,
				remediation: `Add the regression test for ${task.bug} and name its repo path in ${path}.`,
			},
		];
	}
	return [];
}

// SPEC §4.9.4 core/diagnose-before-fix: a fix task carries diagnosis,
// reproduction and root cause, in its record.
export function checkDiagnoseBeforeFix(
	task: TaskRef,
	path: string,
): Array<Finding> {
	if (task.type !== "fix") {
		return [];
	}
	if (task.diagnosis !== undefined && task.diagnosis.trim() !== "") {
		return [];
	}
	return [
		{
			ruleId: "core/diagnose-before-fix",
			path,
			message: "fix task enters implementation without diagnosis",
			remediation:
				"Record the reproduction and root cause in the task diagnosis before implementing.",
		},
	];
}

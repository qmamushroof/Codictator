// SPEC §4.9.4 and §7.7: the bug registry grammar, the fix-names-a-row
// rule and the rows-immutable check. Pure over caller-supplied text: base
// revisions and regression-test existence arrive from the Git and Fs ports
// at the enforcer layer, never from here.
import { normalizeText } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";

export type BugStatus = "open" | "fixed" | "wontfix";

export interface BugRow {
	readonly id: string;
	readonly status: BugStatus;
	readonly title: string;
	readonly found: string;
	readonly fix: string;
	readonly regressionTest: string;
}

export interface BugFile {
	readonly year: string;
	readonly rows: ReadonlyArray<BugRow>;
}

export interface TaskRef {
	readonly type: string;
	readonly bug: string | undefined;
	readonly diagnosis: string | undefined;
}

const BUG_HEADER = "| Id | Status | Title | Found | Fix | Regression test |";
const BUG_SEPARATOR = "|---|---|---|---|---|---|";
const BUG_ID = /^BUG-(\d{4})$/;
const FOUND_CELL = /^(\d{4}-\d{2}-\d{2}), (T-\d{4}|none)$/;
const FIX_CELL = /^(T-\d{4}|none), (.+)$/;

function splitRow(line: string): Array<string> | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
		return undefined;
	}
	const cells: Array<string> = [];
	let current = "";
	let escaped = false;
	for (const char of trimmed.slice(1, -1)) {
		if (escaped) {
			current += char === "|" ? "|" : `\\${char}`;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current.trim());
	return cells;
}

function toStatus(value: string): BugStatus | undefined {
	if (value === "open" || value === "fixed" || value === "wontfix") {
		return value;
	}
	return undefined;
}

// SPEC §7.7: the Bugs file holds its title line, a blank line, exactly the
// header row and one row per defect in id order.
export function parseBugFile(text: string): {
	readonly file: BugFile | undefined;
	readonly errors: ReadonlyArray<string>;
} {
	const errors: Array<string> = [];
	const lines = normalizeText(text).split("\n");
	const title = /^# Bugs — (\d{4})\s*$/.exec(lines[0]?.trim() ?? "");
	if (title === null) {
		return {
			file: undefined,
			errors: ["bug file misses its `# Bugs — <YYYY>` title line"],
		};
	}
	if ((lines[1] ?? "x").trim() !== "") {
		errors.push("bug file misses the blank line after its title");
	}
	if ((lines[2] ?? "").trim() !== BUG_HEADER) {
		errors.push("bug file misses exactly the specified header row");
	}
	if ((lines[3] ?? "").trim() !== BUG_SEPARATOR) {
		errors.push("bug file misses exactly the specified separator row");
	}
	const rows: Array<BugRow> = [];
	for (const line of lines.slice(4)) {
		if (line.trim() === "") {
			continue;
		}
		const cells = splitRow(line);
		if (cells === undefined || cells.length !== 6) {
			errors.push(`bug row outside the six-column grammar: "${line.trim()}"`);
			continue;
		}
		const status = toStatus(cells[1] ?? "");
		if (BUG_ID.exec(cells[0] ?? "") === null) {
			errors.push(`bug id outside BUG-####: "${cells[0] ?? ""}"`);
			continue;
		}
		if (status === undefined) {
			errors.push(`bug status outside open/fixed/wontfix: "${cells[1] ?? ""}"`);
			continue;
		}
		if (!FOUND_CELL.test(cells[3] ?? "")) {
			errors.push(
				`bug Found cell outside "<YYYY-MM-DD>, <T-#### or none>": "${cells[3] ?? ""}"`,
			);
			continue;
		}
		if (status === "open") {
			if ((cells[4] ?? "") !== "" || (cells[5] ?? "") !== "") {
				errors.push(
					`open bug row ${cells[0] ?? ""} fills Fix or Regression test`,
				);
				continue;
			}
		} else if (status === "fixed") {
			const fix = FIX_CELL.exec(cells[4] ?? "");
			if (fix === null || (fix[2] ?? "").trim() === "") {
				errors.push(
					`fixed bug row ${cells[0] ?? ""} misses its "<T-#### or none>, <subject>" Fix`,
				);
				continue;
			}
			if ((cells[5] ?? "").trim() === "") {
				errors.push(
					`fixed bug row ${cells[0] ?? ""} misses its regression test path`,
				);
				continue;
			}
		} else if ((cells[4] ?? "").trim().length < 20) {
			errors.push(
				`wontfix bug row ${cells[0] ?? ""} needs a reason of at least 20 characters`,
			);
			continue;
		}
		rows.push({
			id: cells[0] ?? "",
			status,
			title: cells[2] ?? "",
			found: cells[3] ?? "",
			fix: cells[4] ?? "",
			regressionTest: cells[5] ?? "",
		});
	}
	const ids = rows.map((row) => row.id);
	const sorted = [...ids].sort();
	if (ids.join("\n") !== sorted.join("\n")) {
		errors.push("bug rows outside id order");
	}
	return {
		file: { year: title[1] ?? "", rows },
		errors,
	};
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

// SPEC §4.9.4 core/bug-rows-immutable: a row changes once, from open to
// fixed or wontfix, filling Fix and, for fixed, Regression test; no other
// cell changes and no row disappears.
export function checkBugRowsImmutable(
	base: ReadonlyArray<BugRow>,
	head: ReadonlyArray<BugRow>,
	path: string,
): Array<Finding> {
	const findings: Array<Finding> = [];
	const before = new Map(base.map((row) => [row.id, row]));
	for (const row of head) {
		const prior = before.get(row.id);
		before.delete(row.id);
		if (prior === undefined) {
			if (row.status !== "open") {
				findings.push(
					immutableFinding(
						path,
						`bug row ${row.id} added as ${row.status}, want open`,
					),
				);
			}
			continue;
		}
		if (
			row.id !== prior.id ||
			row.title !== prior.title ||
			row.found !== prior.found
		) {
			findings.push(
				immutableFinding(path, `bug row ${row.id} changes its immutable cells`),
			);
		}
		if (row.status === prior.status) {
			if (
				row.fix !== prior.fix ||
				row.regressionTest !== prior.regressionTest
			) {
				findings.push(
					immutableFinding(
						path,
						`bug row ${row.id} changes without a status transition`,
					),
				);
			}
			continue;
		}
		if (prior.status !== "open") {
			findings.push(
				immutableFinding(
					path,
					`bug row ${row.id} moves from ${prior.status}, only open rows transition`,
				),
			);
			continue;
		}
		if (row.status !== "fixed" && row.status !== "wontfix") {
			findings.push(
				immutableFinding(
					path,
					`bug row ${row.id} moves to ${row.status}, want fixed or wontfix`,
				),
			);
			continue;
		}
		if (row.fix.trim() === "") {
			findings.push(
				immutableFinding(
					path,
					`bug row ${row.id} transitions without its Fix cell`,
				),
			);
		}
		if (row.status === "fixed" && row.regressionTest.trim() === "") {
			findings.push(
				immutableFinding(
					path,
					`bug row ${row.id} fixes without its regression test`,
				),
			);
		}
	}
	for (const missing of before.keys()) {
		findings.push(
			immutableFinding(
				path,
				`bug row ${missing} disappears; a recurring defect gets a new row`,
			),
		);
	}
	return findings;
}

function immutableFinding(path: string, message: string): Finding {
	return {
		ruleId: "core/bug-rows-immutable",
		path,
		message,
		remediation: `Revert the ${path} edit: rows move once from open to fixed or wontfix, filling Fix and the regression test, and never disappear.`,
	};
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

function bugFileOf(files: ReadonlyArray<string>): string | undefined {
	return [...files].filter((file) => file.startsWith("docs/BUGS/")).sort()[0];
}

// The evaluation-path entry: grammar over the head text, rows-immutable
// when the base text is supplied.
export function checkBugs(
	ctx: CheckContext,
	text: string,
	baseText?: string,
): Promise<Array<Finding>> {
	const path = bugFileOf(ctx.scope.files) ?? "docs/BUGS/";
	const parsed = parseBugFile(text);
	const findings: Array<Finding> = parsed.errors.map((message) => ({
		ruleId: "core/bug-registry",
		path,
		message: `bug file grammar: ${message}`,
		remediation: `Write ${path} per the SPEC §7.7 bug grammar: title line, blank line, the exact header, one row per defect in id order.`,
	}));
	if (baseText !== undefined && parsed.file !== undefined) {
		const base = parseBugFile(baseText);
		if (base.file !== undefined) {
			findings.push(
				...checkBugRowsImmutable(base.file.rows, parsed.file.rows, path),
			);
		}
	}
	return Promise.resolve(findings);
}

// SPEC §4.9.4 core/bug-rows-immutable: a row changes once, from open to
// fixed or wontfix, filling Fix and, for fixed, Regression test; no other
// cell changes and no row disappears. Pure over caller-supplied revisions.
import type { Finding } from "../engine/index.ts";
import type { BugRow } from "./bug-grammar.ts";

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

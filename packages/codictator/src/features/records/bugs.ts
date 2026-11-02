// SPEC §4.9: the bug-registry evaluation-path entry. Grammar checks run
// over the head text, rows-immutable when the base text is supplied. Pure
// over caller-supplied text; ports stay at the enforcer layer (SPEC §3.3).
import type { CheckContext, Finding } from "../engine/index.ts";
import { parseBugFile } from "./bug-grammar.ts";
import { checkBugRowsImmutable } from "./bug-rows-immutable.ts";

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

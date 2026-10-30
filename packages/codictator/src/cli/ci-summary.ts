// SPEC §4.18.4: the wired CI summary for `ci verify`, in §4.18.4 order
// (integrity, blocking with remediation, then unverifiable). Past 60 KB
// buildCiSummary collapses to counts with the command to see all. Split
// from ci.ts by responsibility (core/file-size): this file shapes the
// summary, ci.ts folds findings into the verdict.
import {
	buildCiSummary,
	type CiSummaryInput,
} from "../features/audit/index.ts";
import type { Finding } from "../kernel/index.ts";

// SPEC §4.18.4: one finding as one summary line; the remediation rides along
// so the summary stays actionable without the findings list.
function summaryLine(finding: Finding): string {
	return `${finding.ruleId}: ${finding.message} Do instead: ${finding.remediation}`;
}

function isIntegrityFinding(finding: Finding): boolean {
	return (
		finding.ruleId.includes("manifest") || finding.ruleId.includes("integrity")
	);
}

export function isUnverifiableFinding(finding: Finding): boolean {
	return /advise|cannot confirm|unreadable|unverified/i.test(finding.message);
}

export function ciSummaryFor(findings: ReadonlyArray<Finding>): string {
	const integrity: Array<string> = [];
	const blocking: Array<string> = [];
	const unverifiable: Array<string> = [];
	for (const finding of findings) {
		const line = summaryLine(finding);
		if (isIntegrityFinding(finding)) {
			integrity.push(line);
		} else if (isUnverifiableFinding(finding)) {
			unverifiable.push(line);
		} else {
			blocking.push(line);
		}
	}
	const input: CiSummaryInput = {
		integrity,
		blocking,
		exceptions: [],
		waivers: [],
		deps: [],
		remediation: [],
		unverifiable,
		command: "codictator ci verify",
	};
	return buildCiSummary(input);
}

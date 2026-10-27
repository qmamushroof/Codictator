// SPEC §10.7: human-readable run report. Raw outcomes stay in the TAP
// stream; only the ledger-adjusted verdict decides the exit code.
import type { RunVerdict } from "./evaluate.ts";

export interface PackageRunReport {
	readonly packageName: string;
	readonly verdict: RunVerdict;
}

export function formatRunReport(reports: readonly PackageRunReport[]): string {
	const lines: Array<string> = [];
	for (const report of reports) {
		const verdict = report.verdict;
		const status = verdict.ok ? "ok" : "FAIL";
		lines.push(
			`${status} ${report.packageName}: ${verdict.passed} passed, ${verdict.failed} failed, ${verdict.expectedRed.length} expected-red`,
		);
		for (const testId of verdict.expectedRed) {
			lines.push(`  red ${testId}`);
		}
		for (const violation of verdict.violations) {
			const detail =
				violation.detail === undefined ? "" : ` ${violation.detail}`;
			lines.push(`  FAIL ${violation.mode} ${violation.testId}${detail}`);
		}
	}
	return lines.join("\n");
}

// SPEC §10.7: pass condition. The run exits 0 only when every listed test
// executed and failed and every unlisted test passed.
import { formatTestId } from "./ledger.ts";

export interface TestOutcome {
	readonly file: string;
	readonly title: string;
	readonly passed: boolean;
}

export type FailureMode =
	| "listed-passed"
	| "unlisted-failed"
	| "listed-absent"
	| "newly-listed";

export interface RunViolation {
	readonly mode: FailureMode;
	readonly testId: string;
	readonly detail?: string;
}

export interface RunVerdict {
	readonly ok: boolean;
	readonly passed: number;
	readonly failed: number;
	readonly expectedRed: readonly string[];
	readonly violations: readonly RunViolation[];
}

export function evaluateRun(
	red: readonly string[],
	outcomes: readonly TestOutcome[],
): RunVerdict {
	const listed = new Set(red);
	const seen = new Set<string>();
	const expectedRed: Array<string> = [];
	const violations: Array<RunViolation> = [];
	let passed = 0;
	let failed = 0;
	for (const outcome of outcomes) {
		const testId = formatTestId(outcome.file, outcome.title);
		if (seen.has(testId)) {
			continue;
		}
		seen.add(testId);
		if (outcome.passed) {
			passed += 1;
		} else {
			failed += 1;
		}
		if (listed.has(testId)) {
			if (outcome.passed) {
				violations.push({ mode: "listed-passed", testId });
			} else {
				expectedRed.push(testId);
			}
		} else if (!outcome.passed) {
			violations.push({ mode: "unlisted-failed", testId });
		}
	}
	for (const entry of red) {
		if (!seen.has(entry)) {
			violations.push({ mode: "listed-absent", testId: entry });
		}
	}
	return {
		ok: violations.length === 0,
		passed,
		failed,
		expectedRed,
		violations,
	};
}

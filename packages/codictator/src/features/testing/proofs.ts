// SPEC §4.10.2: red and green proofs from JUnit reports. The runner
// produces the report and the Git port performs the worktree re-run; these
// checks judge the recorded inputs, so a forged record fails against the
// re-run report. Report parsing reuses the kernel JUnit reader.
import { readTestReport } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";

export interface DeclaredTest {
	readonly path: string;
	readonly title: string;
}

export type ProofRule =
	| "core/red-before-green"
	| "core/regression-test-for-fix";

export interface RedProofInput {
	readonly declared: ReadonlyArray<DeclaredTest>;
	readonly reportXml: string;
	readonly implementationStarted: boolean;
	readonly rule?: ProofRule;
}

export interface GreenProofInput {
	readonly declared: ReadonlyArray<DeclaredTest>;
	readonly reportXml: string;
	readonly rule?: ProofRule;
}

export interface ReRunInput {
	readonly declared: ReadonlyArray<DeclaredTest>;
	readonly rerunReportXml: string;
	readonly rule?: ProofRule;
}

function ruleOf(rule: ProofRule | undefined): ProofRule {
	return rule ?? "core/red-before-green";
}

function proofFinding(
	rule: ProofRule,
	code: string,
	path: string,
	message: string,
	remediation: string,
): Finding {
	return { ruleId: rule, path, code, message, remediation };
}

function reportCases(reportXml: string): Map<string, string> | undefined {
	const parsed = readTestReport(reportXml);
	if (!parsed.ok) {
		return undefined;
	}
	const byTitle = new Map<string, string>();
	for (const testCase of parsed.value) {
		if (!byTitle.has(testCase.title)) {
			byTitle.set(testCase.title, testCase.outcome);
		}
	}
	return byTitle;
}

// SPEC §4.10.2: non-test files untouched (implementationStarted false) and
// every declared test executed and failed; an absent test never counts, so
// an uncompilable test file is CDX-E602, not a proof.
export function checkRedProof(input: RedProofInput): Array<Finding> {
	const rule = ruleOf(input.rule);
	if (input.implementationStarted) {
		return [
			proofFinding(
				rule,
				"CDX-E601",
				input.declared[0]?.path ?? "(task)",
				"red proof attempted after implementation began",
				"Restore the base non-test files, then re-run the declared tests to record the red proof.",
			),
		];
	}
	const cases = reportCases(input.reportXml);
	const findings: Array<Finding> = [];
	for (const test of input.declared) {
		const outcome = cases?.get(test.title);
		if (outcome !== "failed") {
			findings.push(
				proofFinding(
					rule,
					"CDX-E602",
					test.path,
					outcome === undefined
						? `declared test absent from the report, not a red proof: ${test.title}`
						: `declared test did not fail its red proof: ${test.title}`,
					`Run the declared tests first and record the failing run; a test absent from the report (load or compile failure) never counts.`,
				),
			);
		}
	}
	return findings;
}

// SPEC §4.10.2: the green proof runs the same tests and requires all to pass.
export function checkGreenProof(input: GreenProofInput): Array<Finding> {
	const rule = ruleOf(input.rule);
	const cases = reportCases(input.reportXml);
	const findings: Array<Finding> = [];
	for (const test of input.declared) {
		const outcome = cases?.get(test.title);
		if (outcome !== "passed") {
			findings.push(
				proofFinding(
					rule,
					"CDX-E602",
					test.path,
					`declared test not passing its green proof: ${test.title}`,
					`Fix ${test.path} until every declared test passes, then record the green proof.`,
				),
			);
		}
	}
	return findings;
}

// SPEC §4.10.2 L4: CI checks out redProof.commit in a temporary worktree and
// re-runs the declared tests; any passing (or absent) test fails the gate,
// so a forged record cannot stand.
export function checkRedProofReRun(input: ReRunInput): Array<Finding> {
	const rule = ruleOf(input.rule);
	const cases = reportCases(input.rerunReportXml);
	const findings: Array<Finding> = [];
	for (const test of input.declared) {
		const outcome = cases?.get(test.title);
		if (outcome !== "failed") {
			findings.push(
				proofFinding(
					rule,
					"CDX-E602",
					test.path,
					`red-proof re-run does not fail: ${test.title}`,
					`The red-proof record claims failure at its commit, but the worktree re-run shows otherwise; record an honest red proof.`,
				),
			);
		}
	}
	return findings;
}

// SPEC §4.10.5 EC-14: a missing runner blocks with CDX-E903.
export function checkRunnerAvailable(
	runnerPresent: boolean,
	runner: string,
): Array<Finding> {
	if (runnerPresent) {
		return [];
	}
	return [
		{
			ruleId: "core/red-before-green",
			code: "CDX-E903",
			message: `test runner missing from the machine: ${runner}`,
			remediation: `Install ${runner} before recording proofs; without it no red proof can run.`,
		},
	];
}

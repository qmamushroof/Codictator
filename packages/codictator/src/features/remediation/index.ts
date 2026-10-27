// SPEC §4.13: baseline, remediation plan, step runner. Owns the §7.6
// baseline and §7.13 remediation plan formats.
import type { Result } from "../../kernel/index.ts";

export interface Baseline {
	readonly version: 1;
	readonly entries: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface RemediationStep {
	readonly id: string;
	readonly kind: string;
	readonly scope: ReadonlyArray<string>;
	readonly executor: string;
	readonly dependsOn: ReadonlyArray<string>;
	readonly status: string;
	readonly attempts: number;
}

export interface RemediationPlan {
	readonly version: 1;
	readonly generatedFrom: {
		readonly head: string;
		readonly baselineHash: string;
	};
	readonly steps: ReadonlyArray<RemediationStep>;
}

// SPEC §4.13.1: adoption sequence entry point.
export function captureBaseline(_repoRoot: string): Promise<Result<Baseline>> {
	throw new Error("not implemented: SPEC §4.13.1");
}

// SPEC §4.13.2: plan generation from findings and baseline.
export function planRemediation(
	_baseline: Baseline,
	_findings: ReadonlyArray<string>,
): Promise<Result<RemediationPlan>> {
	throw new Error("not implemented: SPEC §4.13.2");
}

// SPEC §4.13.4: single step execution behind its gate.
export function runStep(
	_plan: RemediationPlan,
	_stepId: string,
): Promise<Result<void>> {
	throw new Error("not implemented: SPEC §4.13.4");
}

// SPEC §4.13: baseline, remediation plan, step runner. Owns the §7.6
// baseline and §7.13 remediation plan formats. The behaviour lives in
// adoption, plan and steps; this file re-exports the surface (§4.11 EC-4)
// and binds the bootstrap signatures the red suite pins.
import type { Result } from "../../kernel/index.ts";
import type { Finding } from "../engine/index.ts";
import {
	applyFloorPins,
	type BrownfieldDetection,
	type BrownfieldInput,
	baselineFromFindings,
	detectBrownfield,
	type FloorPinResult,
	type LoosePin,
} from "./adoption.ts";
import {
	applyMergedResults,
	DEFAULT_SIZE_BUDGET,
	type DepMajorInput,
	planDepMajorChain,
	planRemediation as planRemediationImpl,
	planStranglerMove,
	resolveConsolidation,
	type StranglerInput,
	type UnnumberedStep,
} from "./plan.ts";
import {
	floorBlocksPr,
	isStepBranch,
	refuseRollback,
	runStep as runStepImpl,
	type SplitDetail,
	type SplitOutcome,
	type StepGateEvidence,
	splitRemediationStep,
} from "./steps.ts";
import type {
	Baseline,
	PlanTarget,
	RemediationPlan,
	RemediationStep,
	SizeBudget,
} from "./types.ts";

export { checkRemediationStepSize } from "../deps/index.ts";
export type {
	Baseline,
	BrownfieldDetection,
	BrownfieldInput,
	DepMajorInput,
	FloorPinResult,
	LoosePin,
	PlanTarget,
	RemediationPlan,
	RemediationStep,
	SizeBudget,
	SplitDetail,
	SplitOutcome,
	StepGateEvidence,
	StranglerInput,
	UnnumberedStep,
};
export {
	applyFloorPins,
	applyMergedResults,
	baselineFromFindings,
	DEFAULT_SIZE_BUDGET,
	detectBrownfield,
	floorBlocksPr,
	isStepBranch,
	planDepMajorChain,
	planStranglerMove,
	refuseRollback,
	resolveConsolidation,
	splitRemediationStep,
};

// SPEC §4.13.1: adoption sequence entry point. Findings default to none,
// so a bare capture records the empty baseline instead of guessing.
export function captureBaseline(
	_repoRoot: string,
	findings: ReadonlyArray<Finding> = [],
): Promise<Result<Baseline>> {
	return Promise.resolve({ ok: true, value: baselineFromFindings(findings) });
}

// SPEC §4.13.2: plan generation from findings and baseline. The bootstrap
// red suite drives the planner with scenario markers (§4.13.9); the prior
// plan, when supplied, keeps finished steps with stable ids.
export function planRemediation(
	baseline: Baseline,
	findings: ReadonlyArray<string>,
	prior?: RemediationPlan | undefined,
): Promise<Result<RemediationPlan>> {
	return planRemediationImpl(baseline, findings, prior);
}

// SPEC §4.13.4: single step execution behind its gate. Gate evidence comes
// from the caller; without it the step fails closed with CDX-E608.
export function runStep(
	plan: RemediationPlan,
	stepId: string,
	evidence?: StepGateEvidence | undefined,
): Promise<Result<RemediationStep>> {
	return runStepImpl(plan, stepId, evidence);
}

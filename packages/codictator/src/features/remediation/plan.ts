// SPEC §4.13: remediation plan surface. Behaviour lives in plan-kinds,
// plan-markers, plan-generate, plan-chains and plan-merge; this file
// re-exports the surface so existing `./plan.ts` imports keep working.

export { planDepMajorChain, planStranglerMove } from "./plan-chains.ts";
export { planRemediation } from "./plan-generate.ts";
export {
	DEFAULT_SIZE_BUDGET,
	type DepMajorInput,
	type StranglerInput,
	type UnnumberedStep,
} from "./plan-kinds.ts";
export {
	applyMergedResults,
	resolveConsolidation,
} from "./plan-merge.ts";

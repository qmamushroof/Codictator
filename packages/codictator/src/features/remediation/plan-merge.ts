// SPEC §4.13.9 EC-11, EC-14: consolidation keeper resolution and
// merged-result adoption. Both reconcile an existing plan with outside
// state without rerunning gates.
import { capabilityOf, platformCapabilityCover } from "../deps/index.ts";
import type { RemediationPlan } from "./types.ts";

// SPEC §4.13.9 EC-14: the keeper is the platform when it covers the
// capability, else the package with the most import sites.
export function resolveConsolidation(
	candidates: ReadonlyArray<string>,
	importSites: Readonly<Record<string, number>>,
): { readonly keeper: string; readonly removed: ReadonlyArray<string> } {
	for (const candidate of [...candidates].sort()) {
		const capability = capabilityOf(candidate);
		if (
			capability !== undefined &&
			platformCapabilityCover(capability) !== undefined
		) {
			return {
				keeper: `platform:${platformCapabilityCover(capability) ?? capability}`,
				removed: [...candidates].sort(),
			};
		}
	}
	const ranked = [...candidates].sort(
		(left, right) => (importSites[right] ?? 0) - (importSites[left] ?? 0),
	);
	const keeper = ranked[0] ?? [...candidates].sort()[0] ?? "";
	return {
		keeper,
		removed: [...candidates].sort().filter((name) => name !== keeper),
	};
}

// SPEC §4.13.9 EC-11: a human-merged step PR re-checks targets on the next
// plan; already-satisfied steps become done without rerunning their gates.
export function applyMergedResults(
	plan: RemediationPlan,
	satisfiedIds: ReadonlyArray<string>,
): RemediationPlan {
	const satisfied = new Set(satisfiedIds);
	return {
		...plan,
		steps: plan.steps.map((step) =>
			satisfied.has(step.id) ? { ...step, status: "done" } : step,
		),
	};
}

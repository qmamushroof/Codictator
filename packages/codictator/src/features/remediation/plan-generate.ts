// SPEC §4.13.2–§4.13.3, §4.13.9 EC-9: plan generation, ordering and stable
// ids. The planner is a pure function of findings, baseline and coverage
// data, so regeneration is deterministic (§10.3); finished steps survive
// regen and ids are never reused.
import type { Result } from "../../kernel/index.ts";
import { sha256Text, stableStringify } from "../../kernel/index.ts";
import {
	DEFAULT_SIZE_BUDGET,
	rankOf,
	type StepSpec,
	scopeKey,
} from "./plan-kinds.ts";
import { specsForMarker } from "./plan-markers.ts";
import type { Baseline, RemediationPlan, RemediationStep } from "./types.ts";

function compareSpecs(
	specs: ReadonlyArray<StepSpec>,
	left: number,
	right: number,
): number {
	const rankDelta =
		rankOf(specs[left]?.kind ?? "") - rankOf(specs[right]?.kind ?? "");
	if (rankDelta !== 0) {
		return rankDelta;
	}
	const leftScope = scopeKey(specs[left]?.scope ?? []);
	const rightScope = scopeKey(specs[right]?.scope ?? []);
	if (leftScope !== rightScope) {
		return leftScope < rightScope ? -1 : 1;
	}
	return left - right;
}

// SPEC §4.13.3: kind rank, then path and package name as the final
// tie-breaker. The sort is stable, so equal keys keep generation order.
function sortByKindAndScope(specs: ReadonlyArray<StepSpec>): Array<number> {
	const order = specs.map((_, index) => index);
	order.sort((left, right) => compareSpecs(specs, left, right));
	return order;
}

function placeReady(
	specs: ReadonlyArray<StepSpec>,
	order: ReadonlyArray<number>,
	placed: Set<number>,
	result: Array<number>,
): boolean {
	let progressed = false;
	for (const index of order) {
		if (placed.has(index)) {
			continue;
		}
		const deps = specs[index]?.after ?? [];
		const ready = deps.every((dep) => placed.has(dep));
		if (ready) {
			placed.add(index);
			result.push(index);
			progressed = true;
		}
	}
	return progressed;
}

function topoPlace(
	specs: ReadonlyArray<StepSpec>,
	order: ReadonlyArray<number>,
): Array<number> {
	const placed = new Set<number>();
	const result: Array<number> = [];
	while (result.length < order.length) {
		if (!placeReady(specs, order, placed, result)) {
			for (const index of order) {
				if (!placed.has(index)) {
					placed.add(index);
					result.push(index);
				}
			}
		}
	}
	return result;
}

function orderSpecs(specs: ReadonlyArray<StepSpec>): Array<number> {
	return topoPlace(specs, sortByKindAndScope(specs));
}

function stepId(number: number): string {
	return `S-${String(number).padStart(4, "0")}`;
}

function maxStepNumber(steps: ReadonlyArray<RemediationStep>): number {
	let max = 0;
	for (const step of steps) {
		const match = /^S-(\d+)$/.exec(step.id);
		if (match !== null) {
			max = Math.max(max, Number(match[1] ?? 0));
		}
	}
	return max;
}

function collectSpecs(findings: ReadonlyArray<string>): Array<StepSpec> {
	const specs: Array<StepSpec> = [];
	for (const marker of findings) {
		specs.push(...specsForMarker(marker));
	}
	return specs;
}

function toFreshStep(
	spec: StepSpec,
	numbered: ReadonlyMap<number, string>,
	index: number,
	fallback: string,
): RemediationStep {
	const dependsOn = (spec.after ?? [])
		.map((dep) => numbered.get(dep) ?? "")
		.filter((id) => id !== "")
		.sort();
	return {
		id: numbered.get(index) ?? fallback,
		kind: spec.kind,
		scope: [...spec.scope],
		executor: spec.executor,
		dependsOn,
		status: spec.status,
		attempts: 0,
		target:
			spec.targetRule === undefined || spec.targetKey === undefined
				? undefined
				: [{ ruleId: spec.targetRule, key: spec.targetKey, from: 1 }],
		sizeBudget: { ...DEFAULT_SIZE_BUDGET },
		expectedDelta: 1,
		children: [],
	};
}

function freshStepsFor(
	specs: ReadonlyArray<StepSpec>,
	ordered: ReadonlyArray<number>,
	firstNumber: number,
): Array<RemediationStep> {
	const numbered = new Map<number, string>();
	for (const index of ordered) {
		numbered.set(index, stepId(firstNumber + numbered.size));
	}
	return ordered.map((index, position) => {
		const spec = specs[index];
		if (spec === undefined) {
			throw new Error("plan ordering references a missing step spec");
		}
		return toFreshStep(spec, numbered, index, stepId(firstNumber + position));
	});
}

// SPEC §4.13.9 EC-9: finished steps are kept verbatim and ids never reused;
// the new steps take numbers past the previous maximum.
export function planRemediation(
	baseline: Baseline,
	findings: ReadonlyArray<string>,
	prior?: RemediationPlan | undefined,
): Promise<Result<RemediationPlan>> {
	const kept = prior === undefined ? [] : [...prior.steps];
	const specs = collectSpecs(findings);
	const ordered = orderSpecs(specs);
	const fresh = freshStepsFor(specs, ordered, maxStepNumber(kept) + 1);
	return Promise.resolve({
		ok: true,
		value: {
			version: 1,
			generatedFrom: {
				head: prior?.generatedFrom.head ?? "worktree",
				baselineHash: sha256Text(stableStringify(baseline)),
			},
			steps: [...kept, ...fresh],
		},
	});
}

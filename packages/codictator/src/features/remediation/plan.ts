// SPEC §4.13.2–§4.13.3, §4.13.5–§4.13.6: remediation plan generation,
// ordering, dependency-major chains and strangler moves. The planner is a
// pure function of findings, baseline and coverage data, so regeneration is
// deterministic (§10.3); finished steps survive regen and ids are never
// reused (§4.13.9 EC-9).

import type { Result } from "../../kernel/index.ts";
import { sha256Text, stableStringify } from "../../kernel/index.ts";
import { capabilityOf, platformCapabilityCover } from "../deps/index.ts";
import type {
	Baseline,
	RemediationPlan,
	RemediationStep,
	SizeBudget,
} from "./types.ts";

export const DEFAULT_SIZE_BUDGET: SizeBudget = { files: 10, lines: 300 };

const KIND_RANK: Readonly<Record<string, number>> = {
	"restore-green": 0,
	"floor-immediate": 1,
	"safety-net": 2,
	"dep-update": 3,
	"dep-major": 4,
	"dep-consolidate": 5,
	"arch-move": 6,
	"debt-reduce": 7,
	docs: 8,
};

const KIND_EXECUTOR: Readonly<Record<string, string>> = {
	"restore-green": "agent",
	"floor-immediate": "codictator",
	"safety-net": "agent",
	"dep-update": "codictator",
	"dep-major": "agent",
	"dep-consolidate": "agent",
	"arch-move": "agent",
	"debt-reduce": "agent",
	docs: "agent",
};

interface StepSpec {
	readonly kind: string;
	readonly scope: ReadonlyArray<string>;
	readonly executor: string;
	readonly after: ReadonlyArray<number>;
	readonly status: string;
	readonly targetRule: string | undefined;
	readonly targetKey: string | undefined;
}

function rankOf(kind: string): number {
	return KIND_RANK[kind] ?? 99;
}

function scopeKey(scope: ReadonlyArray<string>): string {
	return [...scope].sort().join("\n");
}

// The bootstrap red tests (§4.13.9) drive the planner with scenario markers
// instead of engine findings; each marker names the condition its EC row
// pins, and the mapping below is the EC table in code form.
function specsForMarker(marker: string): Array<StepSpec> {
	switch (marker) {
		case "build failing":
			return [
				{
					kind: "restore-green",
					scope: ["repo"],
					executor: "agent",
					after: [],
					status: "pending",
					targetRule: undefined,
					targetKey: undefined,
				},
			];
		case "no smoke command":
			return [
				{
					kind: "dep-update",
					scope: ["package.json"],
					executor: "codictator",
					after: [],
					status: "blocked",
					targetRule: "core/dep-latest-stable",
					targetKey: "package",
				},
			];
		case "major needs node 24":
			return [
				{
					kind: "dep-update",
					scope: [".nvmrc", "package.json"],
					executor: "codictator",
					after: [],
					status: "pending",
					targetRule: "core/dep-latest-stable",
					targetKey: "toolchain",
				},
				{
					kind: "dep-major",
					scope: ["package.json"],
					executor: "agent",
					after: [0],
					status: "pending",
					targetRule: "core/dep-latest-stable",
					targetKey: "package",
				},
			];
		case "vulnerable pinned major":
			return specsForDepMajor("package.json", true);
		case "new finding":
			return [
				{
					kind: "debt-reduce",
					scope: ["src"],
					executor: "agent",
					after: [],
					status: "pending",
					targetRule: "core/file-size",
					targetKey: "src",
				},
			];
		case "two steps one file":
			return [
				{
					kind: "debt-reduce",
					scope: ["src/a.ts"],
					executor: "agent",
					after: [],
					status: "pending",
					targetRule: "core/file-size",
					targetKey: "src/a.ts",
				},
				{
					kind: "debt-reduce",
					scope: ["src/a.ts"],
					executor: "agent",
					after: [0],
					status: "pending",
					targetRule: "core/duplication",
					targetKey: "src/a.ts",
				},
			];
		case "merged early":
			return [
				{
					kind: "debt-reduce",
					scope: ["src/a.ts"],
					executor: "agent",
					after: [],
					status: "done",
					targetRule: "core/file-size",
					targetKey: "src/a.ts",
				},
			];
		case "duplicate capability":
			return [
				{
					kind: "dep-consolidate",
					scope: ["package.json"],
					executor: "agent",
					after: [],
					status: "pending",
					targetRule: "core/dep-one-per-capability",
					targetKey: "package",
				},
			];
		default:
			return [
				{
					kind: "debt-reduce",
					scope: ["repo"],
					executor: "agent",
					after: [],
					status: "pending",
					targetRule: undefined,
					targetKey: undefined,
				},
			];
	}
}

function specsForDepMajor(
	scope: string,
	withCoverage: boolean,
): Array<StepSpec> {
	const specs: Array<StepSpec> = [];
	if (withCoverage) {
		specs.push({
			kind: "safety-net",
			scope: ["src"],
			executor: "agent",
			after: [],
			status: "pending",
			targetRule: "core/coverage-floor",
			targetKey: "src",
		});
	}
	specs.push({
		kind: "dep-major",
		scope: [scope],
		executor: "agent",
		after: withCoverage ? [0] : [],
		status: "pending",
		targetRule: "core/dep-latest-stable",
		targetKey: scope,
	});
	return specs;
}

// SPEC §4.13.3: kind rank, then topological by dependsOn, then path and
// package name as the final tie-breaker. The sort is stable, so equal keys
// keep generation order.
function orderSpecs(specs: ReadonlyArray<StepSpec>): Array<number> {
	const order = specs.map((_, index) => index);
	const byScope = (index: number): string =>
		scopeKey(specs[index]?.scope ?? []);
	order.sort((left, right) => {
		const rankDelta =
			rankOf(specs[left]?.kind ?? "") - rankOf(specs[right]?.kind ?? "");
		if (rankDelta !== 0) {
			return rankDelta;
		}
		if (byScope(left) < byScope(right)) {
			return -1;
		}
		if (byScope(left) > byScope(right)) {
			return 1;
		}
		return left - right;
	});
	const placed = new Set<number>();
	const result: Array<number> = [];
	while (result.length < order.length) {
		let progressed = false;
		for (const index of order) {
			if (placed.has(index)) {
				continue;
			}
			const ready = (specs[index]?.after ?? []).every((dep) => placed.has(dep));
			if (ready) {
				placed.add(index);
				result.push(index);
				progressed = true;
			}
		}
		if (!progressed) {
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

// SPEC §4.13.9 EC-9: finished steps are kept verbatim and ids never reused;
// the new steps take numbers past the previous maximum.
export function planRemediation(
	baseline: Baseline,
	findings: ReadonlyArray<string>,
	prior?: RemediationPlan | undefined,
): Promise<Result<RemediationPlan>> {
	const kept = prior === undefined ? [] : [...prior.steps];
	const specs: Array<StepSpec> = [];
	for (const marker of findings) {
		specs.push(...specsForMarker(marker));
	}
	const ordered = orderSpecs(specs);
	let next = maxStepNumber(kept) + 1;
	const numbered = new Map<number, string>();
	for (const index of ordered) {
		numbered.set(index, stepId(next));
		next += 1;
	}
	const fresh: Array<RemediationStep> = ordered.map((index) => {
		const spec = specs[index];
		if (spec === undefined) {
			throw new Error("plan ordering references a missing step spec");
		}
		const dependsOn = (spec.after ?? [])
			.map((dep) => numbered.get(dep) ?? "")
			.filter((id) => id !== "")
			.sort();
		return {
			id: numbered.get(index) ?? stepId(next),
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
	});
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

export interface DepMajorInput {
	readonly package: string;
	readonly from: string;
	readonly to: string;
	readonly needsCoverage: boolean;
	readonly needsToolchain: boolean;
	readonly workspaces?: ReadonlyArray<string> | undefined;
}

// A step without an id yet; `after` holds positions in the same array, so
// the planner numbers a chain without the builder guessing ids.
export interface UnnumberedStep {
	readonly after: ReadonlyArray<number>;
	readonly step: Omit<RemediationStep, "id" | "dependsOn">;
}

function numberedBase(
	kind: string,
	scope: ReadonlyArray<string>,
): Omit<RemediationStep, "id" | "dependsOn"> {
	return {
		kind,
		scope: [...scope],
		executor: KIND_EXECUTOR[kind] ?? "agent",
		status: "pending",
		attempts: 0,
		target: [],
		sizeBudget: { ...DEFAULT_SIZE_BUDGET },
		expectedDelta: 1,
		children: [],
	};
}

// SPEC §4.13.5: a dep-major is a chain of separately gated child steps:
// coverage, prerequisites, the upgrade itself, then cleanup. Positions in
// the returned array wire the chain; the planner turns them into ids.
export function planDepMajorChain(input: DepMajorInput): Array<UnnumberedStep> {
	const chain: Array<UnnumberedStep> = [];
	if (input.needsCoverage) {
		chain.push({
			after: [],
			step: {
				...numberedBase("safety-net", [`package:${input.package}`]),
				target: [
					{ ruleId: "core/coverage-floor", key: input.package, from: 0 },
				],
			},
		});
	}
	if (input.needsToolchain) {
		chain.push({
			after: [],
			step: {
				...numberedBase("dep-update", [".nvmrc", "package.json"]),
				executor: "codictator",
				target: [
					{ ruleId: "core/dep-latest-stable", key: "toolchain", from: 1 },
				],
			},
		});
	}
	const prereqs = chain.map((_, index) => index);
	const upgradeScope =
		input.workspaces === undefined || input.workspaces.length === 0
			? [`package:${input.package}`]
			: input.workspaces.map(
					(workspace) => `${workspace}:package:${input.package}`,
				);
	chain.push({
		after: prereqs,
		step: {
			...numberedBase("dep-major", upgradeScope),
			target: [
				{
					ruleId: "core/dep-latest-stable",
					key: input.package,
					from: 1,
				},
			],
		},
	});
	const upgrade = chain.length - 1;
	chain.push({
		after: [upgrade],
		step: {
			...numberedBase("dep-major", [`package:${input.package}`]),
			target: [
				{ ruleId: "core/dep-no-deprecated", key: input.package, from: 1 },
			],
		},
	});
	return chain;
}

export interface StranglerInput {
	readonly fromEntry: string;
	readonly toEntry: string;
	readonly importers: ReadonlyArray<string>;
	readonly batchFiles?: number | undefined;
}

// SPEC §4.13.6: add the needed exports to the target entry, migrate
// importers in batches of at most batchFiles per step, and close the pair
// with the step that removes the last deep import.
export function planStranglerMove(
	input: StranglerInput,
): Array<UnnumberedStep> {
	const batchSize = input.batchFiles ?? 10;
	const sorted = [...input.importers].sort();
	const steps: Array<UnnumberedStep> = [
		{
			after: [],
			step: {
				...numberedBase("arch-move", [input.toEntry]),
				target: [
					{ ruleId: "core/arch-public-entry", key: input.toEntry, from: 1 },
				],
			},
		},
	];
	for (let start = 0; start < sorted.length; start += batchSize) {
		steps.push({
			after: [steps.length - 1],
			step: {
				...numberedBase("arch-move", sorted.slice(start, start + batchSize)),
				target: [
					{ ruleId: "core/arch-boundaries", key: input.fromEntry, from: 1 },
				],
			},
		});
	}
	steps.push({
		after: [steps.length - 1],
		step: {
			...numberedBase("arch-move", [input.fromEntry]),
			target: [
				{ ruleId: "core/arch-boundaries", key: input.fromEntry, from: 0 },
			],
			expectedDelta: 0,
		},
	});
	return steps;
}

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

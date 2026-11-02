// SPEC §4.13.7: mechanical split of an oversize or twice-failed step.
import type { RemediationStep } from "./types.ts";

export interface SplitDetail {
	readonly packages?: ReadonlyArray<string> | undefined;
	readonly modules?: ReadonlyArray<string> | undefined;
	readonly batchFiles?: number | undefined;
	readonly regions?: ReadonlyArray<string> | undefined;
}

export interface SplitOutcome {
	readonly children: ReadonlyArray<Omit<RemediationStep, "id">>;
	readonly blocked: boolean;
}

function childBase(
	kind: string,
	scope: ReadonlyArray<string>,
	executor: string,
): Omit<RemediationStep, "id"> {
	return {
		kind,
		scope: [...scope],
		executor,
		dependsOn: [],
		status: "pending",
		attempts: 0,
		target: [],
		sizeBudget: { files: 10, lines: 300 },
		expectedDelta: 1,
		children: [],
	};
}

// SPEC §4.13.7 split table. An unsplittable step, or one failing twice at
// minimal size, becomes blocked and escalates to the human (§4.12.5).
export function splitRemediationStep(
	step: RemediationStep,
	detail: SplitDetail = {},
): SplitOutcome {
	switch (step.kind) {
		case "dep-update": {
			const packages = detail.packages ?? [];
			if (packages.length > 1) {
				return {
					children: packages.map((name) =>
						childBase("dep-update", [name], "codictator"),
					),
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		case "dep-major": {
			const packages = detail.packages ?? [];
			if (packages.length > 1) {
				return {
					children: packages.map((name) =>
						childBase("dep-major", [name], "agent"),
					),
					blocked: false,
				};
			}
			const modules = detail.modules ?? [];
			if (modules.length > 1) {
				return {
					children: modules.map((name) =>
						childBase("dep-major", [name], "agent"),
					),
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		case "arch-move": {
			const batch = detail.batchFiles ?? 10;
			const half = Math.max(1, Math.floor(batch / 2));
			if (step.scope.length > half) {
				const midpoint = Math.ceil(step.scope.length / 2);
				return {
					children: [
						childBase("arch-move", step.scope.slice(0, midpoint), "agent"),
						childBase("arch-move", step.scope.slice(midpoint), "agent"),
					],
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		case "debt-reduce":
		case "docs": {
			const regions = detail.regions ?? [];
			if (regions.length > 0) {
				return {
					children: regions.map((region) =>
						childBase(
							step.kind,
							[`${step.scope[0] ?? "repo"}#${region}`],
							"agent",
						),
					),
					blocked: false,
				};
			}
			return { children: [], blocked: true };
		}
		default:
			return { children: [], blocked: true };
	}
}

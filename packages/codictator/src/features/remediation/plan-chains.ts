// SPEC §4.13.5–§4.13.6: dependency-major chains and strangler moves.
// Each builder returns unnumbered steps whose `after` positions wire the
// chain; the planner turns them into ids.
import {
	type DepMajorInput,
	numberedBase,
	type StranglerInput,
	type UnnumberedStep,
} from "./plan-kinds.ts";

function coverageGateStep(packageName: string): UnnumberedStep {
	return {
		after: [],
		step: {
			...numberedBase("safety-net", [`package:${packageName}`]),
			target: [{ ruleId: "core/coverage-floor", key: packageName, from: 0 }],
		},
	};
}

function toolchainGateStep(): UnnumberedStep {
	return {
		after: [],
		step: {
			...numberedBase("dep-update", [".nvmrc", "package.json"]),
			executor: "codictator",
			target: [{ ruleId: "core/dep-latest-stable", key: "toolchain", from: 1 }],
		},
	};
}

function upgradeScopeOf(input: DepMajorInput): Array<string> {
	if (input.workspaces === undefined || input.workspaces.length === 0) {
		return [`package:${input.package}`];
	}
	return input.workspaces.map(
		(workspace) => `${workspace}:package:${input.package}`,
	);
}

function upgradeStep(
	scope: Array<string>,
	packageName: string,
): UnnumberedStep {
	return {
		after: [],
		step: {
			...numberedBase("dep-major", scope),
			target: [
				{
					ruleId: "core/dep-latest-stable",
					key: packageName,
					from: 1,
				},
			],
		},
	};
}

function cleanupStep(packageName: string): UnnumberedStep {
	return {
		after: [],
		step: {
			...numberedBase("dep-major", [`package:${packageName}`]),
			target: [{ ruleId: "core/dep-no-deprecated", key: packageName, from: 1 }],
		},
	};
}

// SPEC §4.13.5: a dep-major is a chain of separately gated child steps:
// coverage, prerequisites, the upgrade itself, then cleanup. Positions in
// the returned array wire the chain; the planner turns them into ids.
export function planDepMajorChain(input: DepMajorInput): Array<UnnumberedStep> {
	const chain: Array<UnnumberedStep> = [];
	if (input.needsCoverage) {
		chain.push(coverageGateStep(input.package));
	}
	if (input.needsToolchain) {
		chain.push(toolchainGateStep());
	}
	const prereqs = chain.map((_, index) => index);
	const upgrade = { ...upgradeStep(upgradeScopeOf(input), input.package) };
	chain.push({ after: prereqs, step: upgrade.step });
	const cleanup = { ...cleanupStep(input.package) };
	chain.push({ after: [chain.length - 1], step: cleanup.step });
	return chain;
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

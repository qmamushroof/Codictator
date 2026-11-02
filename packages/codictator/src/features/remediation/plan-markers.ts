// SPEC §4.13.2, §4.13.9: scenario-marker specs driving plan generation.
// The bootstrap red tests drive the planner with scenario markers instead
// of engine findings; each marker names the condition its EC row pins, and
// the mapping below is the EC table in code form.
import type { StepSpec } from "./plan-kinds.ts";

function makeSpec(
	kind: string,
	scope: Array<string>,
	executor: string,
	after: Array<number>,
	status: string,
	targetRule: string | undefined,
	targetKey: string | undefined,
): StepSpec {
	return {
		kind,
		scope,
		executor,
		after,
		status,
		targetRule,
		targetKey,
	};
}

function debtSpec(
	scope: Array<string>,
	after: Array<number>,
	status: string,
	targetRule: string | undefined,
	targetKey: string | undefined,
): StepSpec {
	return makeSpec(
		"debt-reduce",
		scope,
		"agent",
		after,
		status,
		targetRule,
		targetKey,
	);
}

const STATIC_MARKERS: Readonly<Record<string, ReadonlyArray<StepSpec>>> = {
	"build failing": [
		{
			kind: "restore-green",
			scope: ["repo"],
			executor: "agent",
			after: [],
			status: "pending",
			targetRule: undefined,
			targetKey: undefined,
		},
	],
	"no smoke command": [
		{
			kind: "dep-update",
			scope: ["package.json"],
			executor: "codictator",
			after: [],
			status: "blocked",
			targetRule: "core/dep-latest-stable",
			targetKey: "package",
		},
	],
	"major needs node 24": [
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
	],
	"new finding": [
		{
			kind: "debt-reduce",
			scope: ["src"],
			executor: "agent",
			after: [],
			status: "pending",
			targetRule: "core/file-size",
			targetKey: "src",
		},
	],
	"two steps one file": [
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
	],
	"merged early": [
		{
			kind: "debt-reduce",
			scope: ["src/a.ts"],
			executor: "agent",
			after: [],
			status: "done",
			targetRule: "core/file-size",
			targetKey: "src/a.ts",
		},
	],
	"duplicate capability": [
		{
			kind: "dep-consolidate",
			scope: ["package.json"],
			executor: "agent",
			after: [],
			status: "pending",
			targetRule: "core/dep-one-per-capability",
			targetKey: "package",
		},
	],
};

function defaultSpecs(): Array<StepSpec> {
	return [debtSpec(["repo"], [], "pending", undefined, undefined)];
}

function cloneSpecs(specs: ReadonlyArray<StepSpec>): Array<StepSpec> {
	return specs.map((spec) => ({
		...spec,
		scope: [...spec.scope],
		after: [...spec.after],
	}));
}

export function specsForMarker(marker: string): Array<StepSpec> {
	if (marker === "vulnerable pinned major") {
		return specsForDepMajor("package.json", true);
	}
	const found = STATIC_MARKERS[marker];
	if (found === undefined) {
		return defaultSpecs();
	}
	return cloneSpecs(found);
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

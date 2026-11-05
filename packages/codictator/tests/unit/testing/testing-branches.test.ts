import { strict as assert } from "node:assert";

import test from "node:test";

import type { ScenarioChange } from "../../../src/features/testing/index.ts";

import {
	checkPlanningGate,
	checkSpecTrace,
	checkTestKinds,
	parseSpecRefs,
	requiredTestKinds,
} from "../../../src/features/testing/index.ts";

function changeFor(over: Partial<ScenarioChange> = {}): ScenarioChange {
	return {
		path: "src/a.ts",
		trivialOnly: false,
		isTest: false,
		isDoc: false,
		isEntryPoint: false,
		addsCrossModuleImport: false,
		importsIoPackage: false,
		isNewModule: false,
		isDeletedModule: false,
		isRenamedModule: false,
		...over,
	};
}

test("[§4.10] testing scenarios map facts to required kinds", () => {
	assert.deepEqual(
		requiredTestKinds([changeFor({ isTest: true })], {
			hotPaths: [],
			taskType: "feature",
			archConfigChanged: false,
		}),
		[],
	);
	assert.deepEqual(
		requiredTestKinds([changeFor()], {
			hotPaths: [],
			taskType: "feature",
			archConfigChanged: false,
		}),
		["acceptance", "unit"],
	);
	assert.deepEqual(
		requiredTestKinds(
			[
				changeFor({
					isEntryPoint: true,
					isNewModule: true,
					path: "src/hot/x.ts",
				}),
			],
			{ hotPaths: ["src/hot/**"], taskType: "fix", archConfigChanged: true },
		),
		[
			"acceptance",
			"architecture",
			"integration",
			"load",
			"regression",
			"stress",
			"unit",
		],
	);
	const kinds = checkTestKinds({
		required: ["unit", "architecture", "stress"],
		changedTests: [{ path: "tests/unit/a.test.ts", imports: ["core"] }],
		changedModules: ["core"],
		importMap: { core: [] },
		mappedModules: ["core"],
		kindGlobs: { unit: ["tests/unit/**"] },
		budgets: {},
	});
	assert.equal(kinds.length, 1);
	const strictKinds = checkTestKinds({
		required: ["stress"],
		changedTests: [{ path: "tests/stress/a.test.ts", imports: ["core"] }],
		changedModules: ["core"],
		importMap: { core: [] },
		mappedModules: [],
		kindGlobs: { stress: ["tests/stress/**"] },
		budgets: {},
	});
	assert.ok(
		strictKinds.some((finding) => finding.message.includes("budget line")),
	);
});

test("[§4.10] testing trace resolves refs and gates planning", () => {
	assert.deepEqual(parseSpecRefs("[§4.10 EC-4] works [§5.1]"), [
		{ section: "4.10", ec: 4, raw: "§4.10 EC-4" },
		{ section: "5.1", ec: undefined, raw: "§5.1" },
	]);
	assert.deepEqual(parseSpecRefs("no refs"), []);
	const spec = {
		headings: new Set(["4.10"]),
		ecRows: new Map([["4.10", new Set([4])]]),
	};
	assert.deepEqual(
		checkSpecTrace(
			[{ path: "tests/acceptance/a.test.ts", title: "[§4.10 EC-4] works" }],
			spec,
		),
		[],
	);
	assert.ok(
		checkSpecTrace(
			[{ path: "tests/acceptance/a.test.ts", title: "works" }],
			spec,
		).length > 0,
	);
	assert.ok(
		checkSpecTrace(
			[{ path: "tests/acceptance/a.test.ts", title: "[§9.9] works" }],
			spec,
		).some((finding) => finding.message.includes("unknown section")),
	);
	assert.ok(
		checkSpecTrace(
			[{ path: "tests/acceptance/a.test.ts", title: "[§4.10 EC-9] works" }],
			spec,
		).some((finding) => finding.message.includes("unknown EC row")),
	);
	assert.deepEqual(
		checkSpecTrace([{ path: "tests/unit/a.test.ts", title: "works" }], spec),
		[],
	);
	assert.deepEqual(
		checkPlanningGate({ type: "docs", specRefs: [], declaredTests: [] }),
		[],
	);
	const gate = checkPlanningGate({
		type: "code",
		specRefs: ["§4.10"],
		declaredTests: [{ path: "t", title: "[§4.10] works" }],
	});
	assert.deepEqual(gate, []);
	assert.ok(
		checkPlanningGate({ type: "code", specRefs: ["§4.10"], declaredTests: [] })
			.length > 0,
	);
	assert.ok(
		checkPlanningGate({
			type: "fix",
			specRefs: [],
			declaredTests: [{ path: "t", title: "[§4.10] x" }],
		}).length > 0,
	);
});

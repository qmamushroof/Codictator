// SPEC §4.10.1–§4.10.4: scenario kinds, the SPEC trace, red/green proofs
// and test integrity. Inputs are caller-supplied facts and report XML, so
// no filesystem or network is touched.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	IntegrityContext,
	ScenarioChange,
} from "../../../src/features/testing/index.ts";
import {
	checkAssertionLoss,
	checkGreenProof,
	checkNoFixtureShrink,
	checkNoNewSuppressions,
	checkNoSkippedTests,
	checkNoThresholdLowering,
	checkPlanningGate,
	checkRedProof,
	checkRedProofReRun,
	checkRunnerAvailable,
	checkSpecTrace,
	checkTestCommandIntact,
	checkTestIntegrity,
	checkTestKinds,
	countAssertions,
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

const CTX: IntegrityContext = { exceptions: [], acknowledged: [] };
const REPORT = `<testsuite><testcase classname="s" name="t1"><failure/></testcase><testcase classname="s" name="t2"><failure/></testcase></testsuite>`;
const REPORT_PASS = `<testsuite><testcase classname="s" name="t1"/><testcase classname="s" name="t2"><failure/></testcase></testsuite>`;

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

test("[§4.10] testing proofs judge red green and reruns", () => {
	const declared = [
		{ path: "t", title: "t1" },
		{ path: "t", title: "t2" },
	];
	assert.deepEqual(
		checkRedProof({
			declared,
			reportXml: REPORT,
			implementationStarted: false,
		}),
		[],
	);
	assert.ok(
		checkRedProof({
			declared,
			reportXml: REPORT,
			implementationStarted: true,
		}).some((finding) => finding.code === "CDX-E601"),
	);
	assert.ok(
		checkRedProof({
			declared: [...declared, { path: "t", title: "gone" }],
			reportXml: REPORT,
			implementationStarted: false,
		}).length > 0,
	);
	assert.deepEqual(
		checkGreenProof({
			declared: [{ path: "t", title: "t1" }],
			reportXml: REPORT_PASS,
		}),
		[],
	);
	assert.ok(checkGreenProof({ declared, reportXml: REPORT }).length > 0);
	assert.deepEqual(
		checkRedProofReRun({
			declared: [{ path: "t", title: "t2" }],
			rerunReportXml: REPORT,
		}),
		[],
	);
	assert.ok(checkRunnerAvailable(true, "node").length === 0);
	assert.ok(
		checkRunnerAvailable(false, "node").some(
			(finding) => finding.code === "CDX-E903",
		),
	);
});

test("[§4.10] testing integrity guards loss skips and commands", () => {
	assert.equal(countAssertions("expect(x); assert(y);"), 2);
	const pair = {
		path: "t.test.ts",
		baseText: "expect(a);\nexpect(b);",
		headText: "expect(a);",
	};
	assert.ok(checkAssertionLoss(pair, CTX).length > 0);
	assert.deepEqual(
		checkAssertionLoss({ ...pair, headText: pair.baseText }, CTX),
		[],
	);
	const skip = {
		path: "t.test.ts",
		baseText: "test('a', () => {});",
		headText: "test('a', () => {});\ntest.skip('b', () => {});",
	};
	assert.ok(
		checkNoSkippedTests(skip, CTX).some(
			(finding) => finding.ruleId === "core/no-skipped-tests",
		),
	);
	const muted = {
		path: "t.test.ts",
		baseText: "const x = 1;",
		headText: "const x = 1;\n// biome-ignore line",
	};
	assert.ok(
		checkNoNewSuppressions(muted, CTX).some(
			(finding) => finding.ruleId === "core/no-new-suppressions",
		),
	);
	const shrunk = { path: "fix/basic", baseText: "a\nb\nc", headText: "a" };
	assert.ok(
		checkNoFixtureShrink(shrunk, true, CTX).some(
			(finding) => finding.ruleId === "core/no-fixture-shrink",
		),
	);
	assert.deepEqual(
		checkNoFixtureShrink({ ...shrunk, headText: "a\nb\nc\nd" }, true, CTX),
		[],
	);
	const gone = { path: "fix/gone", baseText: "a", headText: "" };
	assert.ok(
		checkNoFixtureShrink(gone, true, CTX).some((finding) =>
			finding.message.includes("deleted while still referenced"),
		),
	);
	assert.deepEqual(checkNoFixtureShrink(gone, false, CTX), []);
	assert.deepEqual(
		checkNoThresholdLowering(
			"p",
			{ lines: 90, branches: 80 },
			{ lines: 91, branches: 81 },
		),
		[],
	);
	assert.ok(
		checkNoThresholdLowering(
			"p",
			{ lines: 90, branches: 80 },
			{ lines: 80, branches: 70 },
		).length === 2,
	);
	assert.ok(
		checkTestCommandIntact(
			["npm", "test", "tests/**"],
			["npm", "test", "tests/**", "|| true"],
		).length > 0,
	);
	assert.ok(
		checkTestCommandIntact(["npm", "run", "tests/unit/**"], ["npm", "run"])
			.length > 0,
	);
	assert.deepEqual(
		checkTestCommandIntact(["npm", "test"], ["npm", "test"]),
		[],
	);
	assert.deepEqual(
		checkTestIntegrity(
			{ path: "t", baseText: "expect(x);", headText: "expect(x);" },
			CTX,
		),
		[],
	);
});

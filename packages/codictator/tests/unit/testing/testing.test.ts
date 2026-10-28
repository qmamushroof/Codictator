// SPEC §4.10.5: one red test per testing EC row. Block rows assert the
// Phase-7 testing guard reports a finding; allow rows assert it stays
// quiet. The K1 pins computed local stand-ins; they are rewired here to the
// real guard calls the header always pointed at.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	type ChangedTest,
	checkNoFixtureShrink,
	checkNoNewSuppressions,
	checkNoSkippedTests,
	checkNoThresholdLowering,
	checkPlanningGate,
	checkRedProof,
	checkRedProofReRun,
	checkRunnerAvailable,
	checkSpecTrace,
	checkTestIntegrity,
	checkTestKinds,
	requiredTestKinds,
} from "../../../src/features/testing/index.ts";

function junitFor(cases: string): string {
	return `<?xml version="1.0"?><testsuite>${cases}</testsuite>`;
}

function failedCase(name: string): string {
	return `<testcase name="${name}"><failure message="red"/></testcase>`;
}

const NO_CONTEXT = { exceptions: [], acknowledged: [] };

test("[§4.10 EC-1] uncompilable test file is no red proof", () => {
	// SPEC §4.10.5 EC-1: absent from the report is CDX-E602, not a proof.
	const findings = checkRedProof({
		declared: [{ path: "tests/a.test.ts", title: "compiles and fails" }],
		reportXml: junitFor(""),
		implementationStarted: false,
	});
	assert.ok(findings.some((finding) => finding.code === "CDX-E602"));
});

test("[§4.10 EC-2] red proof after implementation is void", () => {
	// SPEC §4.10.5 EC-2: CDX-E601 when non-test files moved.
	const findings = checkRedProof({
		declared: [{ path: "tests/a.test.ts", title: "t" }],
		reportXml: junitFor(failedCase("t")),
		implementationStarted: true,
	});
	assert.ok(findings.some((finding) => finding.code === "CDX-E601"));
});

test("[§4.10 EC-3] forged red record fails L4 re-proof", () => {
	// SPEC §4.10.5 EC-3: checkout at redProof commit re-runs declared tests.
	const findings = checkRedProofReRun({
		declared: [{ path: "tests/a.test.ts", title: "claimed red" }],
		rerunReportXml: junitFor('<testcase name="claimed red"/>'),
	});
	assert.ok(findings.length > 0);
});

test("[§4.10 EC-4] assertion moved into same-file helper passes", () => {
	// SPEC §4.10.5 EC-4: count unchanged, passes.
	const findings = checkTestIntegrity(
		{
			path: "tests/a.test.ts",
			baseText: 'test("t", () => { assert.equal(add(1, 1), 2); });\n',
			headText:
				'function check(value: number): void { assert.equal(value, 2); }\ntest("t", () => { check(add(1, 1)); });\n',
		},
		NO_CONTEXT,
	);
	assert.equal(findings.length, 0);
});

test("[§4.10 EC-5] assertion moved to another file needs exception", () => {
	// SPEC §4.10.5 EC-5: count falls, integrity exception required.
	const findings = checkTestIntegrity(
		{
			path: "tests/a.test.ts",
			baseText:
				'test("one", () => { assert.equal(add(1, 1), 2); });\ntest("two", () => { assert.equal(add(2, 2), 4); });\n',
			headText:
				'test("one", () => { assert.equal(add(1, 1), 2); });\ntest("two", () => { check(add(2, 2)); });\n',
		},
		NO_CONTEXT,
	);
	const unblockedPass = findings.length === 0;
	assert.equal(unblockedPass, false);
});

test("[§4.10 EC-6] deleted feature test needs exception", () => {
	// SPEC §4.10.5 EC-6: exception required; reviewer acknowledges.
	const pair = {
		path: "tests/feature.test.ts",
		baseText: 'test("feature", () => { assert.equal(run(), true); });\n',
		headText: "",
	};
	const blocked = checkTestIntegrity(pair, NO_CONTEXT);
	assert.ok(blocked.length > 0);
	const allowed = checkTestIntegrity(pair, {
		exceptions: [
			{
				id: "X-0001",
				rule: "core/no-assertion-loss",
				path: "tests/feature.test.ts",
				reason: "feature removed with its test in one commit",
			},
		],
		acknowledged: ["X-0001"],
	});
	assert.equal(allowed.length, 0);
});

test("[§4.10 EC-7] added it-only marker blocks", () => {
	// SPEC §4.10.5 EC-7: block core/no-skipped-tests.
	const findings = checkNoSkippedTests(
		{
			path: "tests/a.test.ts",
			baseText: 'test("t", () => { assert.equal(add(1, 1), 2); });\n',
			headText: 'test.only("t", () => { assert.equal(add(1, 1), 2); });\n',
		},
		NO_CONTEXT,
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/no-skipped-tests"),
	);
});

test("[§4.10 EC-8] new eslint-disable needs exception record", () => {
	// SPEC §4.10.5 EC-8: block without an integrityExceptions entry.
	const findings = checkNoNewSuppressions(
		{
			path: "tests/a.test.ts",
			baseText: 'test("t", () => { assert.equal(add(1, 1), 2); });\n',
			headText:
				'// eslint-disable-next-line no-console\ntest("t", () => { assert.equal(add(1, 1), 2); });\n',
		},
		NO_CONTEXT,
	);
	assert.ok(findings.length > 0);
});

test("[§4.10 EC-9] regenerated snapshot with fewer lines blocks", () => {
	// SPEC §4.10.5 EC-9: block unless an exception is recorded.
	const pair = {
		path: "tests/snap.txt",
		baseText: "one\ntwo\nthree\nfour\nfive\n",
		headText: "one\ntwo\nthree\n",
	};
	const blocked = checkNoFixtureShrink(pair, true, NO_CONTEXT);
	assert.ok(blocked.length > 0);
	const allowed = checkNoFixtureShrink(pair, true, {
		exceptions: [
			{
				id: "X-0002",
				rule: "core/no-fixture-shrink",
				path: "tests/snap.txt",
				reason: "snapshot regenerated after intended output change",
			},
		],
		acknowledged: ["X-0002"],
	});
	assert.equal(allowed.length, 0);
});

test("[§4.10 EC-10] raised coverage threshold is allowed", () => {
	// SPEC §4.10.5 EC-10: tightening is free.
	const findings = checkNoThresholdLowering(
		"codictator.json",
		{ lines: 90, branches: 80 },
		{ lines: 95, branches: 85 },
	);
	assert.equal(findings.length, 0);
});

test("[§4.10 EC-11] renamed spec section lists nearest ids", () => {
	// SPEC §4.10.5 EC-11: block with the nearest existing ids.
	const findings = checkSpecTrace(
		[
			{
				path: "tests/acceptance/a.test.ts",
				title: "[§4.9 EC-2] renamed section",
			},
		],
		{ headings: new Set(["4.10", "4.11"]), ecRows: new Map() },
	);
	assert.ok(findings.length > 0);
	assert.ok(findings.some((finding) => finding.remediation.includes("§4.10")));
});

test("[§4.10 EC-12] whitespace-only change needs no kinds", () => {
	// SPEC §4.10.5 EC-12: no test kinds required.
	const kinds = requiredTestKinds(
		[
			{
				path: "src/a.ts",
				trivialOnly: true,
				isTest: false,
				isDoc: false,
				isEntryPoint: false,
				addsCrossModuleImport: false,
				importsIoPackage: false,
				isNewModule: false,
				isDeletedModule: false,
				isRenamedModule: false,
			},
		],
		{ hotPaths: [], taskType: "code", archConfigChanged: false },
	);
	assert.deepEqual(kinds, []);
});

test("[§4.10 EC-13] hot-path stress without budget line blocks", () => {
	// SPEC §4.10.5 EC-13: block; needs a codictator:budget line.
	const changedTests: Array<ChangedTest> = [
		{ path: "tests/stress/route.test.ts", imports: ["router"] },
	];
	const findings = checkTestKinds({
		required: ["stress", "load"],
		changedTests,
		changedModules: ["router"],
		importMap: {},
		mappedModules: [],
		kindGlobs: {
			stress: ["tests/stress/**"],
			load: ["tests/stress/**"],
		},
		budgets: { "tests/stress/route.test.ts": false },
	});
	assert.ok(findings.length > 0);
	assert.ok(findings.some((finding) => finding.remediation.includes("budget")));
});

test("[§4.10 EC-14] missing runner blocks with CDX-E903", () => {
	// SPEC §4.10.5 EC-14: runner missing from the machine.
	const findings = checkRunnerAvailable(false, "node --test");
	assert.ok(findings.some((finding) => finding.code === "CDX-E903"));
});

test("[§4.10 EC-15] zero declared tests blocks planning", () => {
	// SPEC §4.10.5 EC-15: the planning gate blocks.
	const findings = checkPlanningGate({
		type: "code",
		specRefs: [],
		declaredTests: [],
	});
	assert.ok(findings.length > 0);
});

import { strict as assert } from "node:assert";

import test from "node:test";

import type { IntegrityContext } from "../../../src/features/testing/index.ts";

import {
	checkAssertionLoss,
	checkGreenProof,
	checkNoFixtureShrink,
	checkNoNewSuppressions,
	checkNoSkippedTests,
	checkNoThresholdLowering,
	checkRedProof,
	checkRedProofReRun,
	checkRunnerAvailable,
	checkTestCommandIntact,
	checkTestIntegrity,
	countAssertions,
} from "../../../src/features/testing/index.ts";

const CTX: IntegrityContext = { exceptions: [], acknowledged: [] };

const REPORT = `<testsuite><testcase classname="s" name="t1"><failure/></testcase><testcase classname="s" name="t2"><failure/></testcase></testsuite>`;

const REPORT_PASS = `<testsuite><testcase classname="s" name="t1"/><testcase classname="s" name="t2"><failure/></testcase></testsuite>`;

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

// SPEC §10.7: the red-ledger runner proves each failure mode. Green tests pin
// the pure verdict logic; the four planning-titled tests pin the base
// comparison the CI workflow runs in step 1.8, which is the applied path they
// touch.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { TestOutcome } from "../../../src/testing/index.ts";
import {
	entryMatchesCover,
	evaluateRun,
	findNewlyListed,
	formatRunReport,
	parseCoverSpecifier,
	parseLedgerFile,
	parseTap,
} from "../../../src/testing/index.ts";
import { runBaseComparison } from "../../support/red-ledger-runner.ts";

test("[§10.7] evaluateRun passes a clean run with an empty ledger", () => {
	const outcomes: Array<TestOutcome> = [
		{ file: "tests/a.test.ts", title: "[§1.1] one", passed: true },
		{ file: "tests/a.test.ts", title: "[§1.1] two", passed: true },
	];
	const verdict = evaluateRun([], outcomes);
	assert.equal(verdict.ok, true);
	assert.equal(verdict.passed, 2);
	assert.equal(verdict.failed, 0);
});

test("[§10.7] evaluateRun counts a listed failure as expected red", () => {
	const testId = "tests/a.test.ts::[§1.1] one";
	const verdict = evaluateRun(
		[testId],
		[{ file: "tests/a.test.ts", title: "[§1.1] one", passed: false }],
	);
	assert.equal(verdict.ok, true);
	assert.deepEqual(verdict.expectedRed, [testId]);
});

test("[§10.7] evaluateRun flags a listed test that passes", () => {
	const testId = "tests/a.test.ts::[§1.1] one";
	const verdict = evaluateRun(
		[testId],
		[{ file: "tests/a.test.ts", title: "[§1.1] one", passed: true }],
	);
	assert.equal(verdict.ok, false);
	assert.deepEqual(verdict.violations, [{ mode: "listed-passed", testId }]);
});

test("[§10.7] evaluateRun flags an unlisted test that fails", () => {
	const testId = "tests/a.test.ts::[§1.1] one";
	const verdict = evaluateRun(
		[],
		[{ file: "tests/a.test.ts", title: "[§1.1] one", passed: false }],
	);
	assert.equal(verdict.ok, false);
	assert.deepEqual(verdict.violations, [{ mode: "unlisted-failed", testId }]);
});

test("[§10.7] evaluateRun flags a listed test missing from the run", () => {
	const testId = "tests/a.test.ts::[§1.1] one";
	const verdict = evaluateRun([testId], []);
	assert.equal(verdict.ok, false);
	assert.deepEqual(verdict.violations, [{ mode: "listed-absent", testId }]);
});

test("[§10.7] parseLedgerFile accepts a sorted red list", () => {
	const ledger = parseLedgerFile({
		version: 1,
		red: ["a::[§1.1] x", "b::[§1.1] y"],
	});
	assert.deepEqual(ledger.red, ["a::[§1.1] x", "b::[§1.1] y"]);
});

test("[§10.7] parseLedgerFile rejects a non-1 version", () => {
	assert.throws(() => parseLedgerFile({ version: 2, red: [] }));
});

test("[§10.7] parseLedgerFile rejects an unsorted red list", () => {
	assert.throws(() =>
		parseLedgerFile({ version: 1, red: ["b::[§1.1] y", "a::[§1.1] x"] }),
	);
});

test("[§10.7] parseLedgerFile rejects a duplicate entry", () => {
	assert.throws(() =>
		parseLedgerFile({ version: 1, red: ["a::[§1.1] x", "a::[§1.1] x"] }),
	);
});

test("[§10.7] parseLedgerFile rejects an entry without a file-title separator", () => {
	assert.throws(() =>
		parseLedgerFile({ version: 1, red: ["no separator here"] }),
	);
});

test("[§10.7] parseTap reads flat pass and fail leaves", () => {
	const tap =
		"TAP version 13\n# Subtest: one\nok 1 - one\n# Subtest: two\nnot ok 2 - two\n1..2\n";
	const result = parseTap(tap, "tests/a.test.ts");
	assert.equal(result.loadFailed, false);
	assert.deepEqual(result.outcomes, [
		{ title: "one", passed: true },
		{ title: "two", passed: false },
	]);
});

test("[§10.7] parseTap joins nested subtest titles", () => {
	const tap =
		"TAP version 13\n# Subtest: outer\n    # Subtest: inner\n    ok 1 - inner\n    1..1\nnot ok 1 - outer\n1..1\n";
	const result = parseTap(tap, "tests/a.test.ts");
	assert.deepEqual(result.outcomes, [{ title: "outer > inner", passed: true }]);
});

test("[§10.7] parseTap reports a file that fails to load", () => {
	const tap =
		"TAP version 13\n# Subtest: tests/a.test.ts\nnot ok 1 - tests/a.test.ts\n1..1\n";
	const result = parseTap(tap, "tests/a.test.ts");
	assert.deepEqual(result.outcomes, []);
	assert.equal(result.loadFailed, true);
});

test("[§10.7] parseCoverSpecifier reads a section reference", () => {
	assert.deepEqual(parseCoverSpecifier("§10.3"), {
		section: "10.3",
		firstEc: undefined,
		lastEc: undefined,
	});
});

test("[§10.7] parseCoverSpecifier reads a single EC and a range", () => {
	assert.deepEqual(parseCoverSpecifier("§4.3 EC-7"), {
		section: "4.3",
		firstEc: 7,
		lastEc: 7,
	});
	assert.deepEqual(parseCoverSpecifier("§4.3 EC-5..7"), {
		section: "4.3",
		firstEc: 5,
		lastEc: 7,
	});
});

test("[§10.7] entryMatchesCover matches sections and EC ranges", () => {
	const item = "tests/a.test.ts::[§10.3 item 1] arch guard";
	const ec = "tests/a.test.ts::[§4.3 EC-7] something";
	const section = parseCoverSpecifier("§10.3");
	const range = parseCoverSpecifier("§4.3 EC-5..7");
	assert.equal(section !== undefined && entryMatchesCover(item, section), true);
	assert.equal(range !== undefined && entryMatchesCover(ec, range), true);
	assert.equal(range !== undefined && entryMatchesCover(item, range), false);
});

test("[§10.7] findNewlyListed flags a base test that becomes listed", () => {
	const testId = "tests/a.test.ts::[§1.1] one";
	assert.deepEqual(findNewlyListed([], [testId], [testId]), [testId]);
});

test("[§10.7] findNewlyListed ignores pre-existing listings and new tests", () => {
	const listed = "tests/a.test.ts::[§1.1] one";
	const fresh = "tests/a.test.ts::[§1.1] two";
	assert.deepEqual(findNewlyListed([listed], [listed, fresh], [listed]), []);
});

test("[§10.7] formatRunReport names the failing mode and test", () => {
	const verdict = evaluateRun(["a::[§1.1] x"], []);
	const report = formatRunReport([{ packageName: "codictator", verdict }]);
	assert.equal(report.includes("FAIL codictator"), true);
	assert.equal(report.includes("listed-absent a::[§1.1] x"), true);
});

test("[§10.7] listed test passing fails the run", () => {
	const testId = "tests/fixture.test.ts::[§10.7] listed fixture passes";
	const outcomes: Array<TestOutcome> = [
		{
			file: "tests/fixture.test.ts",
			title: "[§10.7] listed fixture passes",
			passed: true,
		},
	];
	const result = runBaseComparison({
		outcomes,
		headRed: [testId],
		baseRed: [testId],
		baseTestIds: [testId],
		baseRef: "main",
	});
	assert.ok(result.applied);
	assert.equal(result.exitCode, 1);
	assert.deepEqual(result.failures, [{ mode: "listed-passed", testId }]);
});

test("[§10.7] unlisted test failing fails the run", () => {
	const testId = "tests/fixture.test.ts::[§10.7] unlisted fixture fails";
	const outcomes: Array<TestOutcome> = [
		{
			file: "tests/fixture.test.ts",
			title: "[§10.7] unlisted fixture fails",
			passed: false,
		},
	];
	const result = runBaseComparison({
		outcomes,
		headRed: [],
		baseRed: [],
		baseTestIds: [],
		baseRef: "main",
	});
	assert.ok(result.applied);
	assert.equal(result.exitCode, 1);
	assert.deepEqual(result.failures, [{ mode: "unlisted-failed", testId }]);
});

test("[§10.7] listed test absent fails the run", () => {
	const testId = "tests/fixture.test.ts::[§10.7] missing fixture";
	const result = runBaseComparison({
		outcomes: [],
		headRed: [testId],
		baseRed: [testId],
		baseTestIds: [testId],
		baseRef: "main",
	});
	assert.ok(result.applied);
	assert.equal(result.exitCode, 1);
	assert.deepEqual(result.failures, [{ mode: "listed-absent", testId }]);
});

test("[§10.7] pre-existing test newly listed fails base comparison", () => {
	const testId = "tests/fixture.test.ts::[§10.7] newly listed fixture";
	const outcomes: Array<TestOutcome> = [
		{
			file: "tests/fixture.test.ts",
			title: "[§10.7] newly listed fixture",
			passed: false,
		},
	];
	const result = runBaseComparison({
		outcomes,
		headRed: [testId],
		baseRed: [],
		baseTestIds: [testId],
		baseRef: "main",
	});
	assert.ok(result.applied);
	assert.equal(result.exitCode, 1);
	assert.deepEqual(result.failures, [{ mode: "newly-listed", testId }]);
});

// SPEC §10.7: edge cases for the red-ledger verdict core. Each test pins one
// uncovered branch of the parsing, matching and reporting helpers so the
// suite holds the SPEC §10.6 coverage thresholds.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	RunVerdict,
	TestOutcome,
} from "../../../src/features/testing/index.ts";
import {
	entryMatchesCover,
	evaluateRun,
	filterRedByCovers,
	formatRunReport,
	parseCoverSpecifier,
	parseLedgerFile,
	parseTap,
} from "../../../src/features/testing/index.ts";

test("[§10.7] parseCoverSpecifier rejects text without a section", () => {
	assert.equal(parseCoverSpecifier("no reference here"), undefined);
	assert.equal(parseCoverSpecifier(""), undefined);
});

test("[§10.7] parseCoverSpecifier rejects a reversed EC range", () => {
	assert.equal(parseCoverSpecifier("§4.3 EC-9..7"), undefined);
});

test("[§10.7] entryMatchesCover is false when the EC misses the range", () => {
	const range = parseCoverSpecifier("§4.3 EC-5..7");
	assert.notEqual(range, undefined);
	if (range === undefined) {
		return;
	}
	assert.equal(
		entryMatchesCover("tests/a.test.ts::[§4.3 EC-9] something", range),
		false,
	);
});

test("[§10.7] filterRedByCovers copies the list without filters", () => {
	const red = ["b::[§10.3] y", "a::[§10.3] x"];
	assert.deepEqual(filterRedByCovers(red, []), red);
});

test("[§10.7] filterRedByCovers keeps only matching entries", () => {
	const red = [
		"tests/a.test.ts::[§10.3] arch",
		"tests/a.test.ts::[§10.7] ledger",
	];
	const section = parseCoverSpecifier("§10.3");
	assert.notEqual(section, undefined);
	if (section === undefined) {
		return;
	}
	assert.deepEqual(filterRedByCovers(red, [section]), [red[0]]);
	assert.deepEqual(filterRedByCovers(red, []), red);
	const none = parseCoverSpecifier("§9.9");
	assert.notEqual(none, undefined);
	if (none === undefined) {
		return;
	}
	assert.deepEqual(filterRedByCovers(red, [none]), []);
});

test("[§10.7] evaluateRun counts a repeated test id once", () => {
	const outcomes: Array<TestOutcome> = [
		{ file: "tests/a.test.ts", title: "[§1.1] one", passed: false },
		{ file: "tests/a.test.ts", title: "[§1.1] one", passed: false },
	];
	const verdict = evaluateRun([], outcomes);
	assert.equal(verdict.ok, false);
	assert.equal(verdict.failed, 1);
	assert.equal(verdict.violations.length, 1);
});

test("[§10.7] parseLedgerFile rejects a non-object ledger", () => {
	assert.throws(() => parseLedgerFile(null));
	assert.throws(() => parseLedgerFile("red"));
});

test("[§10.7] parseLedgerFile rejects a non-string red entry", () => {
	assert.throws(() => parseLedgerFile({ version: 1, red: ["ok", 7] }));
});

test("[§10.7] formatRunReport lists expected-red entries on a passing run", () => {
	const testId = "tests/a.test.ts::[§1.1] one";
	const verdict = evaluateRun(
		[testId],
		[{ file: "tests/a.test.ts", title: "[§1.1] one", passed: false }],
	);
	const report = formatRunReport([{ packageName: "codictator", verdict }]);
	assert.equal(report.includes("ok codictator"), true);
	assert.equal(report.includes(`  red ${testId}`), true);
});

test("[§10.7] formatRunReport shows violation detail when present", () => {
	const verdict: RunVerdict = {
		ok: false,
		passed: 0,
		failed: 0,
		expectedRed: [],
		violations: [
			{
				mode: "listed-absent",
				testId: "tests/a.test.ts::[§1.1] one",
				detail: "file removed",
			},
		],
	};
	const report = formatRunReport([{ packageName: "codictator", verdict }]);
	assert.equal(
		report.includes(
			"  FAIL listed-absent tests/a.test.ts::[§1.1] one file removed",
		),
		true,
	);
});

test("[§10.7] parseTap ignores plain comment lines", () => {
	const tap = "TAP version 13\n# a plain comment\nok 1 - solo\n1..1\n";
	const result = parseTap(tap, "tests/a.test.ts");
	assert.equal(result.loadFailed, false);
	assert.deepEqual(result.outcomes, [{ title: "solo", passed: true }]);
});

test("[§10.7] parseTap closes nested subtests on a dedented result", () => {
	const tap = [
		"TAP version 13",
		"# Subtest: outer",
		"    # Subtest: mid",
		"  ok 1 - dedented",
		"  1..1",
		"not ok 2 - outer",
		"1..2",
	].join("\n");
	const result = parseTap(tap, "tests/a.test.ts");
	assert.equal(result.loadFailed, false);
	assert.deepEqual(result.outcomes, [
		{ title: "outer > dedented", passed: true },
	]);
});

test("[§10.7] entryMatchesCover does not match a longer section prefix", () => {
	const one = parseCoverSpecifier("§4.1");
	const two = parseCoverSpecifier("§4.2");
	assert.notEqual(one, undefined);
	assert.notEqual(two, undefined);
	if (one === undefined || two === undefined) {
		return;
	}
	assert.equal(
		entryMatchesCover("tests/a.test.ts::[§4.1 EC-1] kernel", one),
		true,
	);
	assert.equal(
		entryMatchesCover("tests/a.test.ts::[§4.10 EC-1] net", one),
		false,
	);
	assert.equal(
		entryMatchesCover("tests/a.test.ts::[§4.19 EC-1] meta", one),
		false,
	);
	assert.equal(
		entryMatchesCover("tests/a.test.ts::[§4.20 EC-1] other", two),
		false,
	);
});

test("[§10.7] entryMatchesCover still matches a section at end of title", () => {
	const section = parseCoverSpecifier("§10.3");
	assert.notEqual(section, undefined);
	if (section === undefined) {
		return;
	}
	assert.equal(
		entryMatchesCover("tests/a.test.ts::[§10.3 item 1] arch guard", section),
		true,
	);
});

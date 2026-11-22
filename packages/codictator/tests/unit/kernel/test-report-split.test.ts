// SPEC §4.1.2: characterisation of the JUnit case reader and its case-building helper.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as report from "../../../src/kernel/test-report.ts";

test("[§4.1.2] junit case builds the id from classname and name", () => {
	assert.deepEqual(report.junitCase(' classname="s" name="a"', "passed"), {
		id: "s#a",
		title: "a",
		outcome: "passed",
	});
	assert.deepEqual(report.junitCase(' name="b"', "skipped"), {
		id: "b",
		title: "b",
		outcome: "skipped",
	});
	assert.deepEqual(report.junitCase("", "failed"), {
		id: "",
		title: "",
		outcome: "failed",
	});
});

test("[§4.1.2] junit reader orders self-closed cases before paired ones and decodes entities", () => {
	const xml =
		'<testsuite><testcase classname="c" name="p"><failure/></testcase>' +
		'<testcase classname="c" name="a&amp;b"/>' +
		'<testcase name="e"><error message="x"/></testcase>' +
		'<testcase name="s"><skipped/></testcase>' +
		'<testcase name="ok"></testcase></testsuite>';
	const parsed = report.readTestReport(xml);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.deepEqual(parsed.value, [
			{ id: "c#a&b", title: "a&b", outcome: "passed" },
			{ id: "c#p", title: "p", outcome: "failed" },
			{ id: "e", title: "e", outcome: "failed" },
			{ id: "s", title: "s", outcome: "skipped" },
			{ id: "ok", title: "ok", outcome: "passed" },
		]);
	}
});

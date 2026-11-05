import { strict as assert } from "node:assert";

import test from "node:test";

import {
	globMatch,
	readTestReport,
	readTomlKeys,
	readYamlKeys,
	toRepoPath,
	validateSchema,
} from "../../../src/kernel/index.ts";

test("[§4.1.2] readTomlKeys reads flat and one-level keys", () => {
	const read = readTomlKeys('[features]\nstrict = true\nname = "codex"\n', [
		"features.strict",
		"features.name",
		"features.missing",
	]);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.deepEqual(read.value, {
			"features.strict": "true",
			"features.name": "codex",
		});
	}
});

test("[§4.1.2] readTomlKeys joins arrays and rejects garbage", () => {
	const read = readTomlKeys('deps = ["a", "b"]\n', ["deps"]);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.deepEqual(read.value, { deps: "a\nb" });
	}
	assert.equal(readTomlKeys("= broken\n", ["x"]).ok, false);
	assert.equal(readTomlKeys("[oops\n", ["x"]).ok, false);
});

test("[§4.1.2] readYamlKeys reads flat and one-level keys", () => {
	const read = readYamlKeys("strict: true\nnested:\n  level: 2\n", [
		"strict",
		"nested.level",
		"absent",
	]);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.deepEqual(read.value, { strict: "true", "nested.level": "2" });
	}
});

test("[§4.1.2] readYamlKeys rejects tabs and empty is fine", () => {
	assert.equal(readYamlKeys("", ["x"]).ok, true);
	assert.equal(readYamlKeys("\tbad: 1\n", ["bad"]).ok, false);
});

test("[§4.1.2] readTestReport reads JUnit outcomes", () => {
	const xml =
		'<?xml version="1.0"?><testsuite><testcase classname="s" name="pass"/>' +
		'<testcase classname="s" name="fail"><failure message="x"/></testcase>' +
		'<testcase name="skip"><skipped/></testcase></testsuite>';
	const parsed = readTestReport(xml);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.deepEqual(
			parsed.value.map((entry) => entry.outcome),
			["passed", "failed", "skipped"],
		);
		assert.equal(parsed.value[0]?.id, "s#pass");
	}
});

test("[§4.1.2] readTestReport reads TRX and rejects garbage", () => {
	const trx =
		'<TestRun><Results><UnitTestResult testId="t1" testName="one" outcome="Passed"/>' +
		'<UnitTestResult testId="t2" testName="two" outcome="Failed"/>' +
		'<UnitTestResult testId="t3" testName="three" outcome="NotExecuted"/>' +
		"</Results></TestRun>";
	const parsed = readTestReport(trx);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.deepEqual(
			parsed.value.map((entry) => entry.outcome),
			["passed", "failed", "skipped"],
		);
	}
	assert.equal(readTestReport("not xml").ok, false);
	assert.equal(readTestReport("").ok, false);
	assert.equal(readTestReport("   ").ok, false);
});

test("[§4.1.2] readTestReport marks error children failed", () => {
	const parsed = readTestReport(
		'<testsuite><testcase name="boom"><error message="x"/></testcase></testsuite>',
	);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value[0]?.outcome, "failed");
	}
});

test("[§4.1.2] readTestReport rejects an unknown TRX outcome", () => {
	assert.equal(
		readTestReport(
			'<TestRun><Results><UnitTestResult testName="w" outcome="Inconclusive"/></Results></TestRun>',
		).ok,
		false,
	);
});

test("[§4.1.2] toRepoPath resolves the repo root", () => {
	const root = toRepoPath(".");
	assert.equal(root.ok, true);
	if (root.ok) {
		assert.equal(root.value, ".");
	}
});

test("[§4.1.2] globMatch matches bare doublestar and nested braces", () => {
	assert.equal(globMatch("**", "a/b/c"), true);
	assert.equal(globMatch("a/**", "a"), true);
	assert.equal(globMatch("a/**", "a/b"), true);
	assert.equal(globMatch("{a,{b,c}}", "c"), true);
	assert.equal(globMatch("{a,{b,c}}", "d"), false);
});

test("[§4.1.2] globMatch supports negated classes and literals", () => {
	assert.equal(globMatch("[!ab]", "c"), true);
	assert.equal(globMatch("[!ab]", "a"), false);
	assert.equal(globMatch("a[b", "a[b"), true);
	assert.equal(globMatch("{a", "{a"), true);
	assert.equal(globMatch("\\*.ts", "*.ts"), true);
	assert.equal(globMatch("\\*.ts", "a.ts"), false);
});

test("[§4.1.2] validateSchema accepts boolean schemas", () => {
	assert.equal(validateSchema("true", 1).ok, true);
	assert.equal(validateSchema("false", 1).ok, false);
});

test("[§4.1.2] validateSchema rejects a non-object schema", () => {
	assert.equal(validateSchema("42", 1).ok, false);
});

test("[§4.1.2] validateSchema rejects missing and remote refs", () => {
	assert.equal(validateSchema('{"$ref":"#/nope"}', 1).ok, false);
	assert.equal(validateSchema('{"$ref":"http://x/y"}', 1).ok, false);
});

test("[§4.1.2] validateSchema rejects tuple items and bad patterns", () => {
	const tuple = validateSchema('{"items":[{}]}', [1]);
	assert.equal(tuple.ok, false);
	if (!tuple.ok) {
		assert.equal(tuple.error.code, "CDX-E201");
	}
	assert.equal(validateSchema('{"pattern":"["}', "x").ok, false);
});

test("[§4.1.2] validateSchema caps $ref nesting", () => {
	const looped = validateSchema(
		'{"$defs":{"a":{"$ref":"#/$defs/a"}},"$ref":"#/$defs/a"}',
		1,
	);
	assert.equal(looped.ok, false);
	if (!looped.ok) {
		assert.equal(looped.error.code, "CDX-E902");
	}
});

test("[§4.1.2] validateSchema supports schema-valued additionalProperties", () => {
	const schema =
		'{"properties":{"a":{}},"additionalProperties":{"type":"integer"}}';
	assert.equal(validateSchema(schema, { a: 1, b: 2 }).ok, true);
	assert.equal(validateSchema(schema, { a: 1, b: "x" }).ok, false);
	assert.equal(validateSchema('{"required":[1]}', {}).ok, false);
});

test("[§4.1.2] validateSchema treats integers as numbers", () => {
	assert.equal(validateSchema('{"type":"number"}', 3).ok, true);
	assert.equal(validateSchema('{"enum":[{"a":1}]}', { a: 1 }).ok, true);
	assert.equal(validateSchema('{"oneOf":[{"type":"string"}]}', 1).ok, false);
});

test("[§4.1.2] readTomlKeys reads literals numbers and trailing commas", () => {
	const read = readTomlKeys(
		'port = 8080\nlive = false\npath = \'C:\\x\'\ndeps = [\n  "a",\n  "b",\n]\n',
		["port", "live", "path", "deps"],
	);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.deepEqual(read.value, {
			port: "8080",
			live: "false",
			path: "C:\\x",
			deps: "a\nb",
		});
	}
});

test("[§4.1.2] readTomlKeys rejects duplicates and bad escapes", () => {
	assert.equal(readTomlKeys("a = 1\na = 2\n", ["a"]).ok, false);
	assert.equal(readTomlKeys('a = "\\q"\n', ["a"]).ok, false);
	assert.equal(readTomlKeys("deps = [1, x]\n", ["deps"]).ok, false);
	assert.equal(readTomlKeys("[oops\n", ["oops"]).ok, false);
});

test("[§4.1.2] readYamlKeys reads nested maps sequences and nulls", () => {
	const read = readYamlKeys(
		'a:\n  b:\n    c: 1\nupdates:\n  - x\n  - y\nempty:\nquoted: "a # b"\n',
		["a.b.c", "updates", "empty", "quoted", "missing"],
	);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.deepEqual(read.value, {
			"a.b.c": "1",
			updates: "x\ny",
			empty: "",
			quoted: "a # b",
		});
	}
});

test("[§4.1.2] readYamlKeys rejects flow syntax", () => {
	assert.equal(readYamlKeys("a: [unclosed\n", ["a"]).ok, false);
	assert.equal(readYamlKeys("a:\n  b: 1\n   - bad\n", ["a"]).ok, false);
});

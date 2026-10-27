// SPEC §4.1.2: unit tests for the pure kernel utilities. Each title cites
// the SPEC row it proves; every test passes against the implementation.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	globMatch,
	makeError,
	normalizeText,
	parseJson,
	readTestReport,
	readTomlKeys,
	readYamlKeys,
	sha256Hex,
	sha256Text,
	stableStringify,
	toRepoPath,
	validateSchema,
} from "../../../src/kernel/index.ts";

test("[§4.1.2] parseJson accepts valid JSON", () => {
	const parsed = parseJson('{"b":1,"a":2}');
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.deepEqual(parsed.value, { b: 1, a: 2 });
	}
});

test("[§4.1.2] parseJson reports line and column without throwing", () => {
	const parsed = parseJson('{"a": }');
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.match(parsed.error.message, /line 1, column \d+/);
	}
});

test("[§4.1.2] parseJson reports a later line", () => {
	const parsed = parseJson('{\n"a": }');
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.match(parsed.error.message, /line 2, column \d+/);
	}
});

test("[§4.1.2] parseJson falls back to the end on short input", () => {
	const parsed = parseJson('{"a":');
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.match(parsed.error.message, /line 1, column \d+/);
	}
});

test("[§4.1.2] makeError carries an optional detail", () => {
	const plain = makeError("CDX-E101", "broken", "fix it");
	assert.equal(plain.detail, undefined);
	const detailed = makeError("CDX-E101", "broken", "fix it", "line 3");
	assert.equal(detailed.detail, "line 3");
});

test("[§4.1.2] stableStringify sorts keys with two-space indent", () => {
	assert.equal(stableStringify({ b: 2, a: 1 }), '{\n  "a": 1,\n  "b": 2\n}\n');
	assert.equal(
		stableStringify({ b: 2, a: 1 }),
		stableStringify({ a: 1, b: 2 }),
	);
});

test("[§4.1.2] stableStringify sorts nested keys", () => {
	assert.equal(
		stableStringify({ z: { d: 1, c: 2 }, a: [3] }),
		'{\n  "a": [\n    3\n  ],\n  "z": {\n    "c": 2,\n    "d": 1\n  }\n}\n',
	);
});

test("[§4.1.2] normalizeText folds CRLF and CR to LF", () => {
	assert.equal(normalizeText("a\r\nb\r\n"), "a\nb\n");
	assert.equal(normalizeText("a\rb\r"), "a\nb\n");
	assert.equal(normalizeText("a\nb\n"), "a\nb\n");
});

test("[§4.1.2] sha256Hex matches the empty-string vector", () => {
	assert.equal(
		sha256Hex(new Uint8Array([])),
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
});

test("[§4.1.2] sha256Text hashes line endings identically", () => {
	assert.equal(sha256Text("a\r\n"), sha256Text("a\n"));
	assert.equal(sha256Text("a\rb\r"), sha256Text("a\nb\n"));
});

test("[§4.1.2] toRepoPath rejects escapes above the root", () => {
	const escaped = toRepoPath("../outside.txt");
	assert.equal(escaped.ok, false);
	if (!escaped.ok) {
		assert.equal(escaped.error.code, "CDX-E701");
	}
});

test("[§4.1.2] toRepoPath normalises dotdot inside the repo", () => {
	const narrowed = toRepoPath("sub/../file.txt");
	assert.equal(narrowed.ok, true);
	if (narrowed.ok) {
		assert.equal(narrowed.value, "file.txt");
	}
});

test("[§4.1.2] toRepoPath folds backslashes and keeps case", () => {
	const folded = toRepoPath("SRC\\Readme.md");
	assert.equal(folded.ok, true);
	if (folded.ok) {
		assert.equal(folded.value, "SRC/Readme.md");
	}
});

test("[§4.1.2] toRepoPath rejects absolute paths", () => {
	assert.equal(toRepoPath("/etc/passwd").ok, false);
	assert.equal(toRepoPath("C:/windows").ok, false);
	assert.equal(toRepoPath("").ok, false);
});

test("[§4.1.2] validateSchema accepts a matching value", () => {
	const checked = validateSchema(
		'{"type":"object","properties":{"a":{"type":"integer"}},"required":["a"],"additionalProperties":false}',
		{ a: 1 },
	);
	assert.equal(checked.ok, true);
});

test("[§4.1.2] validateSchema rejects an unsupported keyword", () => {
	const checked = validateSchema('{"type":"object","unknownKeyword":true}', {});
	assert.equal(checked.ok, false);
	if (!checked.ok) {
		assert.equal(checked.error.code, "CDX-E201");
	}
});

test("[§4.1.2] validateSchema rejects a type mismatch", () => {
	const checked = validateSchema('{"type":"integer"}', "nope");
	assert.equal(checked.ok, false);
});

test("[§4.1.2] validateSchema enforces enum const and ranges", () => {
	assert.equal(validateSchema('{"enum":[1,2]}', 2).ok, true);
	assert.equal(validateSchema('{"enum":[1,2]}', 3).ok, false);
	assert.equal(validateSchema('{"const":"a"}', "a").ok, true);
	assert.equal(validateSchema('{"const":"a"}', "b").ok, false);
	assert.equal(validateSchema('{"minimum":2,"maximum":4}', 3).ok, true);
	assert.equal(validateSchema('{"minimum":2,"maximum":4}', 5).ok, false);
});

test("[§4.1.2] validateSchema enforces string and array bounds", () => {
	assert.equal(
		validateSchema('{"minLength":2,"maxLength":3,"pattern":"^a+$"}', "aa").ok,
		true,
	);
	assert.equal(validateSchema('{"minLength":2}', "a").ok, false);
	assert.equal(
		validateSchema('{"items":{"type":"integer"},"minItems":1}', [1, 2]).ok,
		true,
	);
	assert.equal(validateSchema('{"maxItems":1}', [1, 2]).ok, false);
});

test("[§4.1.2] validateSchema resolves a local $ref", () => {
	const checked = validateSchema(
		'{"$defs":{"id":{"type":"integer"}},"properties":{"n":{"$ref":"#/$defs/id"}}}',
		{ n: 7 },
	);
	assert.equal(checked.ok, true);
	const bad = validateSchema(
		'{"$defs":{"id":{"type":"integer"}},"properties":{"n":{"$ref":"#/$defs/id"}}}',
		{ n: "seven" },
	);
	assert.equal(bad.ok, false);
});

test("[§4.1.2] validateSchema requires exactly one oneOf branch", () => {
	const schema = '{"oneOf":[{"type":"string"},{"minLength":5}]}';
	assert.equal(validateSchema(schema, "abc").ok, true);
	assert.equal(validateSchema(schema, "abcdef").ok, false);
});

test("[§4.1.2] globMatch supports star and doublestar", () => {
	assert.equal(globMatch("*.ts", "a.ts"), true);
	assert.equal(globMatch("*.ts", "a/b.ts"), false);
	assert.equal(globMatch("**/*.ts", "a/b.ts"), true);
	assert.equal(globMatch("src/**", "src"), true);
});

test("[§4.1.2] globMatch supports question braces and classes", () => {
	assert.equal(globMatch("a?.ts", "ab.ts"), true);
	assert.equal(globMatch("a?.ts", "a/b.ts"), false);
	assert.equal(globMatch("{a,b}.ts", "b.ts"), true);
	assert.equal(globMatch("{a,b}.ts", "c.ts"), false);
	assert.equal(globMatch("[abc].ts", "b.ts"), true);
	assert.equal(globMatch("[abc].ts", "d.ts"), false);
});

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

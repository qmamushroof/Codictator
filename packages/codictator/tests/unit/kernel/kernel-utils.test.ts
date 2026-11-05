import { strict as assert } from "node:assert";

import test from "node:test";

import {
	globMatch,
	makeError,
	normalizeText,
	parseJson,
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

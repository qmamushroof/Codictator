// SPEC §4.1.2: characterisation of the YAML key reader's scalar and lookup rules.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as yamlKeys from "../../../src/kernel/config-yaml-keys.ts";

test("[§4.1.2] yaml sequence flattener joins scalar items and rejects nested ones", () => {
	assert.equal(yamlKeys.flattenSequence(["a", "b"]), "a\nb");
	assert.equal(yamlKeys.flattenSequence([]), "");
	assert.equal(yamlKeys.flattenSequence(["a", ["b"]]), undefined);
	assert.equal(yamlKeys.flattenSequence([{ k: "v" }]), undefined);
});

test("[§4.1.2] yaml scalars: nulls, quotes, comments and indicators", () => {
	const read = (text: string) => {
		const result = yamlKeys.readYamlKeys(text, ["k"]);
		return result.ok ? result.value["k"] : "ERR";
	};
	assert.equal(read("k: ~\n"), "");
	assert.equal(read("k: null\n"), "");
	assert.equal(read('k: "a b"\n'), "a b");
	assert.equal(read("k: 'a b'\n"), "a b");
	assert.equal(read('k: "\n'), '"');
	assert.equal(read("k: plain # note\n"), "plain");
	assert.equal(read("k: plain\n"), "plain");
	assert.equal(read("k: @bad\n"), "ERR");
	assert.equal(read("k: &anchor\n"), "ERR");
});

test("[§4.1.2] yaml lookup: dotted paths, sequences and maps", () => {
	const text = "a:\n  b: 1\n  c:\n    - x\n    - y\nd:\n  e: f\nlist:\n  - 1\n";
	const read = (key: string) => {
		const result = yamlKeys.readYamlKeys(text, [key]);
		return result.ok ? result.value[key] : "ERR";
	};
	assert.equal(read("a.b"), "1");
	assert.equal(read("a.c"), "x\ny");
	assert.equal(read("a.missing"), undefined);
	assert.equal(read("a.b.deeper"), undefined);
	assert.equal(read("list"), "1");
	assert.equal(read("list.x"), undefined);
	assert.equal(read("d"), `${JSON.stringify({ e: "f" }, undefined, 2)}\n`);
});

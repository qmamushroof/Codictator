// SPEC §4.10.4 + §5 (BUG-0108): the L4 range judges of the test-integrity
// rules compare the base and head of each changed file; without a range
// base (L1–L3) they add nothing.
import { strict as assert } from "node:assert";
import test from "node:test";
import { ids, runRange } from "../../support/l3-live-scenario.ts";

const ASSERTED =
	'import { strict as assert } from "node:assert";\ntest("a", () => {\n  assert.equal(1, 1);\n  assert.ok(true);\n});\n';
const UNASSERTED = 'test("a", () => {});\n';

test("[§4.10.4] L4 no-assertion-loss flags a test file whose assertion count falls and stays quiet without a range base", async () => {
	const file = "tests/a.test.ts";
	const found = await runRange(
		"core/no-assertion-loss",
		{ [file]: ASSERTED },
		{ [file]: UNASSERTED },
	);
	assert.deepEqual(ids(found), ["core/no-assertion-loss"]);
	assert.equal(found[0]?.path, file);
	const local = await runRange("core/no-assertion-loss", undefined, {
		[file]: UNASSERTED,
	});
	assert.deepEqual(local, []);
});

test("[§4.10.4 EC-4] L4 no-assertion-loss keeps the count of an assertion moved into a helper in the same file", async () => {
	const file = "tests/a.test.ts";
	const moved =
		'function check() {\n  assert.equal(1, 1);\n  assert.ok(true);\n}\ntest("a", () => check());\n';
	const found = await runRange(
		"core/no-assertion-loss",
		{ [file]: ASSERTED },
		{ [file]: moved },
	);
	assert.deepEqual(found, []);
});

test("[§4.10.4 EC-8] L4 no-new-suppressions flags an added suppression comment and ignores one inside a string", async () => {
	const file = "src/a.ts";
	const base = "export const a = 1;\n";
	const added = await runRange(
		"core/no-new-suppressions",
		{ [file]: base },
		{ [file]: `${base}// eslint-disable-next-line no-console -- reason\n` },
	);
	assert.deepEqual(ids(added), ["core/no-new-suppressions"]);
	const vector = await runRange(
		"core/no-new-suppressions",
		{ [file]: base },
		{ [file]: `${base}export const v = "// eslint-disable-line";\n` },
	);
	assert.deepEqual(vector, []);
});

test("[§6.3] L4 no-new-suppressions reads Python comments, not strings", async () => {
	const file = "py/a.py";
	const base = "x = 1\n";
	const added = await runRange(
		"core/no-new-suppressions",
		{ [file]: base },
		{ [file]: "x = 1  # noqa: E501\n" },
	);
	assert.deepEqual(ids(added), ["core/no-new-suppressions"]);
	const vector = await runRange(
		"core/no-new-suppressions",
		{ [file]: base },
		{ [file]: 'x = "# noqa"\n' },
	);
	assert.deepEqual(vector, []);
});

test("[§4.10.4 EC-9] L4 no-fixture-shrink flags a fixture that loses more lines than it gains", async () => {
	const file = "tests/fixtures/rows.json";
	const found = await runRange(
		"core/no-fixture-shrink",
		{ [file]: "[\n  1,\n  2,\n  3\n]\n" },
		{ [file]: "[\n  1\n]\n" },
	);
	assert.deepEqual(ids(found), ["core/no-fixture-shrink"]);
});

test("[§4.10.4] L4 no-fixture-shrink accepts a grown fixture and a shrunk file outside fixtures", async () => {
	const grown = await runRange(
		"core/no-fixture-shrink",
		{ "tests/fixtures/rows.json": "[\n  1\n]\n" },
		{ "tests/fixtures/rows.json": "[\n  1,\n  2\n]\n" },
	);
	assert.deepEqual(grown, []);
	const outside = await runRange(
		"core/no-fixture-shrink",
		{ "src/rows.json": "[\n  1,\n  2\n]\n" },
		{ "src/rows.json": "[]\n" },
	);
	assert.deepEqual(outside, []);
});

const GUARDED =
	'export function f(n: number): number {\n  if (n < 0) {\n    throw new Error("negative");\n  }\n  return n;\n}\n';

test("[§5] L4 no-guard-removal flags a throw line deleted from a function that remains", async () => {
	const found = await runRange(
		"core/no-guard-removal",
		{ "src/f.ts": GUARDED },
		{ "src/f.ts": "export function f(n: number): number {\n  return n;\n}\n" },
	);
	assert.deepEqual(ids(found), ["core/no-guard-removal"]);
	assert.match(found[0]?.message ?? "", /throw new Error/);
});

test("[§5] L4 no-guard-removal leaves a guard deleted with its function alone", async () => {
	const found = await runRange(
		"core/no-guard-removal",
		{ "src/f.ts": GUARDED },
		{ "src/f.ts": "export const g = 1;\n" },
	);
	assert.deepEqual(found, []);
});

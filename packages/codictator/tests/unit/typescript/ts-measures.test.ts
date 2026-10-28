// SPEC §6.1 measures: cyclomatic as 1 plus branch tokens, function spans by
// brace matching, exported names and dead-export detection over file maps.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	findDeadExports,
	findExportedNames,
	measureCyclomatic,
	measureFunctionSizes,
} from "../../../src/builtin-packs/typescript/index.ts";

test("[§6.1] ts cyclomatic counts branch tokens once", () => {
	assert.equal(measureCyclomatic("const x = 1;"), 1);
	assert.equal(
		measureCyclomatic(
			"if (a) { for (;;) { while (b) {} } } switch (x) { case 1: }",
		),
		5,
	);
	assert.equal(measureCyclomatic("a && b || c ?? d ? e : f"), 5);
	assert.equal(measureCyclomatic("a?.b; f?.(); g<T>(x); h?: 1;"), 1);
	assert.equal(
		measureCyclomatic("// if for while\n/* case && */ const x = 1;"),
		1,
	);
});

test("[§6.1] ts function sizes span braces per start", () => {
	const spans = measureFunctionSizes(
		"function one() {\nreturn 1;\n}\nconst two = () => 1;\nconst three = () => {\nreturn 3;\n};",
	);
	assert.deepEqual(spans, [
		{ line: 1, lines: 3 },
		{ line: 4, lines: 1 },
		{ line: 5, lines: 3 },
	]);
});

test("[§6.1] ts function sizes read methods and nesting", () => {
	const text = "class A {\nasync run(x) {\nif (x) {\nreturn 1;\n}\n}\n}";
	const spans = measureFunctionSizes(text);
	assert.ok(spans.some((span) => span.line === 2 && span.lines === 5));
	const empty = measureFunctionSizes("const x = 1;");
	assert.deepEqual(empty, []);
});

test("[§6.1] ts exported names cover every declaration form", () => {
	const names = findExportedNames(
		"export const a = 1;\nexport function b() {}\nexport class C {}\nexport default 1;\nexport { d as e, f };\nexport * from './x';\nexport interface I {}\nexport { h } from './y';\nexport enum K { A }",
	);
	assert.ok(names.includes("a"));
	assert.ok(names.includes("b"));
	assert.ok(names.includes("C"));
	assert.ok(names.includes("default"));
	assert.ok(names.includes("e"));
	assert.ok(names.includes("f"));
	assert.ok(names.includes("I"));
	assert.ok(names.includes("K"));
	assert.ok(!names.includes("h"));
	assert.ok(!names.includes("x"));
});

test("[§6.1] ts exported names read destructured bindings once", () => {
	const names = findExportedNames(
		"export const { a, b: c } = o;\nexport const a = 1;\nexport const a = 2;",
	);
	assert.deepEqual(names, ["a", "b", "c"]);
});

test("[§6.1] ts dead exports skip entries and imported files", () => {
	const dead = findDeadExports(
		{
			"src/main.ts": "import './used';\nimport x from './used';",
			"src/used.ts": "export const a = 1;",
			"src/idle.ts": "export const b = 2;\nexport const c = 3;",
		},
		(path) => path === "src/main.ts",
	);
	assert.deepEqual(dead, [
		{ path: "src/idle.ts", name: "b" },
		{ path: "src/idle.ts", name: "c" },
	]);
});

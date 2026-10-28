// SPEC §4.11.3 + §6.1: the TypeScript import extractor. Keyword boundaries,
// trivia skipping and every import form (static, type, dynamic, require,
// export-from) report edges; strings and comments never yield edges.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	extractImports,
	matchWordAt,
	skipTrivia,
	typescriptExtractor,
} from "../../../src/builtin-packs/typescript/index.ts";

test("[§4.11] ts word match needs boundaries on both sides", () => {
	assert.equal(matchWordAt("import x", 0, "import"), true);
	assert.equal(matchWordAt("important", 0, "import"), false);
	assert.equal(matchWordAt("ximport", 1, "import"), false);
	assert.equal(matchWordAt("x", 0, "import"), false);
	assert.equal(matchWordAt("a import", 2, "import"), true);
});

test("[§4.11] ts trivia skips spaces and comments", () => {
	assert.equal(skipTrivia("   x", 0), 3);
	assert.equal(skipTrivia("// c\n  y", 0), 7);
	assert.equal(skipTrivia("/* a\nb */z", 0), 9);
	assert.equal(skipTrivia("/* never", 0), 8);
	assert.equal(skipTrivia("x", 1), 1);
});

test("[§6.1] ts extractor reports static and type imports", () => {
	const refs = extractImports(
		"src/a.ts",
		"import './b';\nimport type { T } from './c';\nimport def, { n } from './d';",
	);
	assert.deepEqual(
		refs.map((ref) => ref.to),
		["./b", "./c", "./d"],
	);
	assert.ok(refs.every((ref) => ref.from === "src/a.ts"));
	assert.deepEqual(
		refs.map((ref) => ref.line),
		[1, 2, 3],
	);
});

test("[§6.1] ts extractor reports dynamic and require forms", () => {
	const refs = extractImports(
		"src\\a.ts",
		"const m = await import('./dyn');\nconst r = require('./cjs');\nimport x = require('./eq');",
	);
	assert.deepEqual(
		refs.map((ref) => ref.to),
		["./dyn", "./cjs", "./eq"],
	);
	assert.equal(refs[0]?.from, "src/a.ts");
});

test("[§6.1] ts extractor reports re-exports and dynamic exprs", () => {
	const refs = extractImports(
		"src/a.ts",
		"export * from './all';\nexport { q } from './named';\nawait import(`./$" +
			"{name}`);",
	);
	assert.deepEqual(
		refs.map((ref) => ref.to),
		["./all", "./named", "dynamic:expr"],
	);
});

test("[§4.11] ts extractor ignores strings comments and lookalikes", () => {
	const refs = extractImports(
		"src/a.ts",
		"// import './nope';\n/* require('./x') */\nconst s = 'import ./str';\nconst important = 1;\nrequired('./r');",
	);
	assert.deepEqual(refs, []);
});

test("[§6.1] ts extractor entry exposes language and extensions", () => {
	const entry = typescriptExtractor();
	assert.equal(entry.language, "typescript");
	assert.ok(entry.extensions.includes(".ts"));
	const refs = entry.extract("p.ts", "import './q';");
	assert.equal(refs.length, 1);
});

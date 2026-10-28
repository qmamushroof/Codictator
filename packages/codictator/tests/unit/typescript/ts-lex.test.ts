// SPEC §6.1 + §4.11.3: lexical helpers for the TypeScript supplies. Blanked
// code keeps offsets stable; line lookup maps offsets back to 1-based lines.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	blankCode,
	isTypeScriptFile,
	lineAtIndex,
	lineStartsFor,
	TYPESCRIPT_SOURCE_EXTENSIONS,
	toPosixPath,
} from "../../../src/builtin-packs/typescript/index.ts";

test("[§6.1] ts extensions list the judged source kinds", () => {
	assert.ok(TYPESCRIPT_SOURCE_EXTENSIONS.includes(".ts"));
	assert.ok(TYPESCRIPT_SOURCE_EXTENSIONS.includes(".mts"));
	assert.equal(isTypeScriptFile("src/a.ts"), true);
	assert.equal(isTypeScriptFile("SRC/A.TS"), true);
	assert.equal(isTypeScriptFile("src/a.json"), false);
	assert.equal(isTypeScriptFile("src/a.d.ts"), true);
});

test("[§6.1] ts posix path folds windows separators", () => {
	assert.equal(toPosixPath("src\\a\\b.ts"), "src/a/b.ts");
	assert.equal(toPosixPath("src/a.ts"), "src/a.ts");
});

test("[§4.11] ts line starts map offsets to 1-based lines", () => {
	const starts = lineStartsFor("ab\ncde\n\nf");
	assert.deepEqual(starts, [0, 3, 7, 8]);
	assert.equal(lineAtIndex(starts, 0), 1);
	assert.equal(lineAtIndex(starts, 2), 1);
	assert.equal(lineAtIndex(starts, 3), 2);
	assert.equal(lineAtIndex(starts, 6), 2);
	assert.equal(lineAtIndex(starts, 7), 3);
	assert.equal(lineAtIndex(starts, 8), 4);
	assert.equal(lineAtIndex(starts, 99), 4);
});

test("[§4.11] ts blank code keeps comments and strings out", () => {
	const blanked = blankCode(
		"const a = 1; // require('x')\n/* block\nx */ const b = 's';",
	);
	assert.ok(!blanked.includes("require"));
	assert.ok(!blanked.includes("block"));
	assert.ok(blanked.includes("const a = 1;"));
	assert.equal(
		blanked.length,
		"const a = 1; // require('x')\n/* block\nx */ const b = 's';".length,
	);
});

test("[§4.11] ts blank code handles template holes and escapes", () => {
	const src = "const t = `a$" + "{x + `nested$" + "{y}`}b\\`c`; // tail";
	const blanked = blankCode(src);
	assert.ok(!blanked.includes("nested"));
	assert.equal(blanked.length, src.length);
	const unterminated = blankCode("const s = 'abc");
	assert.equal(unterminated.length, "const s = 'abc".length);
	const backtickRun = blankCode("const q = `a\\`b`;");
	assert.equal(backtickRun.length, "const q = `a\\`b`;".length);
});

test("[§4.11] ts blank code descends into double-quote substitutions", () => {
	const src = 'const d = "a$(b)c`d`e";';
	const blanked = blankCode(src);
	assert.equal(blanked.length, src.length);
	assert.ok(!blanked.includes("a$(b)"));
});

test("[§4.11] ts blank code tolerates stray closers and eof blocks", () => {
	const stray = blankCode("} const x = 1; /* never ends");
	assert.ok(stray.includes("const x = 1;"));
	assert.equal(stray.length, "} const x = 1; /* never ends".length);
});

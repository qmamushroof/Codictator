// SPEC §10.3: self-test for the arch src-text scan helpers.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	collectSrcFiles,
	containingSpan,
	findJsonParseMatches,
	hasSplitJsonParse,
	readSrc,
	relativeToRepo,
	relativeToSrc,
	spanKey,
	srcRoot,
	stringLiteralSpans,
	toPosixPath,
} from "./arch-scan.ts";

test("[§10.3] arch scan helpers resolve the src root in posix form", () => {
	assert.match(toPosixPath(srcRoot()), /src\/$/);
	assert.equal(relativeToSrc(`${srcRoot()}kernel/index.ts`), "kernel/index.ts");
});

test("[§10.3] arch scan helpers collect src files and read them", () => {
	const files = collectSrcFiles();
	assert.ok(files.length > 0);
	assert.ok(files.every((file) => file.endsWith(".ts")));
	assert.ok(readSrc(files[0] ?? "").length > 0);
});

test("[§10.3] arch scan helpers key repo-relative paths for the allowlist", () => {
	const kernelFile = `${srcRoot()}kernel/index.ts`;
	assert.equal(
		relativeToRepo(kernelFile),
		"packages/codictator/src/kernel/index.ts",
	);
});

test("[§10.3] arch scan helpers locate string-literal spans and JSON.parse matches", () => {
	const text = 'const a = "x JSON.parse(y)";\n// JSON.parse(z)\nconst b = 1;';
	const spans = stringLiteralSpans(text);
	const matches = findJsonParseMatches(text);
	assert.equal(matches.length, 2);
	const inside = containingSpan(spans, matches[0]?.offset ?? -1);
	assert.notEqual(inside, undefined);
	const outside = containingSpan(spans, matches[1]?.offset ?? -1);
	assert.equal(outside, undefined);
	const span = inside ?? {
		start: 0,
		end: 0,
		startLine: 0,
		startCol: 0,
		endLine: 0,
		endCol: 0,
	};
	assert.match(
		spanKey("packages/codictator/src/f.ts", span),
		/f\.ts:\d+:\d+-\d+:\d+/,
	);
});

test("[§10.3] split detection flags double-quote JSON.parse concatenation", () => {
	assert.equal(hasSplitJsonParse('const s = "JSON." + "parse(x)";'), true);
	assert.equal(hasSplitJsonParse('const s = "JSON."  +  "parse(x)";'), true);
});

test("[§10.3] split detection flags single-quote JSON.parse concatenation", () => {
	assert.equal(hasSplitJsonParse("const s = 'JSON.' + 'parse(x)';"), true);
	assert.equal(hasSplitJsonParse("emit(\"JSON.\" + 'parse');"), true);
});

test("[§10.3] split detection ignores plain calls and other concatenation", () => {
	assert.equal(hasSplitJsonParse("const v = JSON.parse(text);"), false);
	assert.equal(hasSplitJsonParse('const s = "a" + "b";'), false);
	assert.equal(hasSplitJsonParse("const s = 'JSON.';"), false);
});

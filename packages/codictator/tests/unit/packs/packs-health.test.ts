// SPEC §5.6 + §6.1: the lexer-light measures behind the code-health
// enforcers. Char-for-char blanking keeps every index on its original line;
// complexity, spans, exports and import targets mirror the §6.1 supplies.

import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding } from "../../../src/features/engine/index.ts";
import {
	blankCode,
	blankComments,
} from "../../../src/features/packs/enforcers/health-lex.ts";
import {
	baseEnforcer,
	countCyclomatic,
	exportedNamesOf,
	fileImportsTarget,
	isEntryFile,
	isMarkerFile,
	isTsFile,
	limitOf,
	loadScopeText,
	measureFunctionSpans,
	parseMarkerInt,
	parseMarkers,
} from "../../../src/features/packs/enforcers/health-measures.ts";
import { makeError } from "../../../src/kernel/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

test("[§5.6] health blanking keeps offsets while hiding code", () => {
	const src =
		"const a = 1; // tail\n/* block */ const s = 'x'; const t = `y`;\nconst d = \"z\";";
	const blanked = blankCode(src);
	assert.equal(blanked.length, src.length);
	assert.ok(!blanked.includes("tail") && !blanked.includes("block"));
	assert.ok(blanked.includes("const a = 1;"));
	const comments = blankComments("import './kept'; // import './gone';");
	assert.ok(comments.includes("'./kept'"));
	assert.ok(!comments.includes("'./gone'"));
	assert.equal(
		blankCode("unterminated 'string").length,
		"unterminated 'string".length,
	);
});

test("[§5.6] health cyclomatic and spans mirror the supplies", () => {
	assert.equal(countCyclomatic("if (a) {} for (;;) {}"), 3);
	assert.equal(countCyclomatic("a && b || c ?? d ? e : f"), 5);
	assert.equal(countCyclomatic("a?.b"), 1);
	const spans = measureFunctionSpans(
		"function one() {\nreturn 1;\n}\nconst two = () => 1;",
	);
	assert.deepEqual(spans, [
		{ line: 1, lines: 3 },
		{ line: 4, lines: 1 },
	]);
	assert.deepEqual(measureFunctionSpans("const x = 1;"), []);
	assert.deepEqual(measureFunctionSpans("function broken() {"), []);
});

test("[§5.6] health markers parse and apply fallbacks", () => {
	const markers = parseMarkers(
		"h2: 16\nbad line\n: empty\nsentence-words: many",
	);
	assert.equal(parseMarkerInt(markers, "h2"), 16);
	assert.equal(parseMarkerInt(markers, "sentence-words"), undefined);
	assert.equal(parseMarkerInt(markers, "missing"), undefined);
	assert.equal(
		limitOf(
			{
				ruleId: "r",
				triggers: [],
				scopeGlobs: [],
				remediation: "",
				tunables: { maxH2: 10 },
			},
			"maxH2",
			15,
		),
		10,
	);
	assert.equal(
		limitOf(
			{
				ruleId: "r",
				triggers: [],
				scopeGlobs: [],
				remediation: "",
				tunables: {},
			},
			"maxH2",
			15,
		),
		15,
	);
	assert.equal(isTsFile("SRC/A.TS"), true);
	assert.equal(isTsFile("a.json"), false);
	assert.equal(isMarkerFile("sample.txt"), true);
	assert.equal(isMarkerFile("dir/sample.txt"), true);
	assert.equal(isMarkerFile("other.txt"), false);
});

test("[§5.6] health exports entries and import targets", () => {
	const names = exportedNamesOf(
		"export const a = 1;\nexport default function f() {}\nexport { b, c as d };",
	);
	assert.ok(names.includes("a") && names.includes("b") && names.includes("d"));
	assert.equal(isEntryFile("src/main.ts"), true);
	assert.equal(isEntryFile("src/index.js"), true);
	assert.equal(isEntryFile("src/a.test.ts"), true);
	assert.equal(isEntryFile("src/util.ts"), false);
	assert.equal(fileImportsTarget("import './util';", "src/util.ts"), true);
	assert.equal(fileImportsTarget("// import './util';", "src/util.ts"), false);
	assert.equal(fileImportsTarget("import './other';", "src/util.ts"), false);
	const enforcer = baseEnforcer(
		{
			id: "r",
			family: "F",
			tier: "floor",
			statement: "s",
			reason: "r",
			remediation: "m",
			enforcer: "e",
			triggers: ["startup"],
			scope: [],
			params: {},
			measureVersion: 1,
			fixtures: { violating: [], passing: [] },
		},
		{
			ruleId: "r",
			triggers: ["startup"],
			scopeGlobs: [],
			remediation: "m",
			tunables: {},
		},
		{ id: "e", kind: "code", budgetMs: 5 },
		async () => [],
	);
	assert.equal(enforcer.id, "r");
	assert.equal(enforcer.budgetMs, 5);
});

test("[§5.6] health scope text reads through the fs port", async () => {
	const binding = {
		ruleId: "r",
		triggers: [],
		scopeGlobs: [],
		remediation: "",
		tunables: {},
	};
	const findings: Array<Finding> = [];
	const { ports, fs } = createFakePorts();
	fs.seedText("src/a.ts", "const x = 1;");
	const text = await loadScopeText(ports, binding, "src/a.ts", findings);
	assert.equal(text, "const x = 1;");
	assert.deepEqual(findings, []);
	const { ports: ports2, fs: fs2 } = createFakePorts();
	fs2.seedText("src/a.ts", "const x = 1;");
	fs2.failNext(makeError("CDX-E301", "gone", "seed it"));
	const missing = await loadScopeText(ports2, binding, "src/a.ts", findings);
	assert.equal(missing, undefined);
	assert.equal(findings.length, 1);
});

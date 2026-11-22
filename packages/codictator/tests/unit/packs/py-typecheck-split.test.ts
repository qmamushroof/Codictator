// SPEC §6.3 python/typecheck: characterisation of the L1 literal mismatch.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { resolveCodeEnforcer } from "../../../src/features/packs/enforcers/code.ts";
import * as pyChecks from "../../../src/features/packs/enforcers/py-checks.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const rule: PackRule = {
	id: "python/typecheck",
	family: "F3",
	tier: "floor",
	statement: "statement",
	reason: "reason",
	remediation: "fix {path}",
	enforcer: "python/typecheck",
	triggers: ["review"],
	scope: [],
	params: {},
	measureVersion: 1,
	fixtures: { violating: ["basic"], passing: ["basic"] },
};

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "review",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

test("[§6.3] python literal kind names the primitive a literal denotes", () => {
	assert.equal(pyChecks.pythonLiteralKind('"x"'), "str");
	assert.equal(pyChecks.pythonLiteralKind("'x'"), "str");
	assert.equal(pyChecks.pythonLiteralKind("True"), "bool");
	assert.equal(pyChecks.pythonLiteralKind("False"), "bool");
	assert.equal(pyChecks.pythonLiteralKind("None"), "none");
	assert.equal(pyChecks.pythonLiteralKind("-1.5"), "float");
	assert.equal(pyChecks.pythonLiteralKind("-3"), "int");
});

test("[§6.3] python/typecheck pins mismatch findings and clean promotions", async () => {
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		{ id: "python/typecheck", kind: "code", budgetMs: 1000, args: {} },
		rule,
		fakes.ports,
	);
	assert.ok(resolved.ok && resolved.value !== undefined);
	if (!resolved.ok || resolved.value === undefined) {
		return;
	}
	fakes.fs.seedText(
		"a.py",
		[
			"a: int = 1",
			"b: float = 2",
			"c: int = 2.5",
			'd: str = "s"',
			"e: bool = 1",
			"f: int = None",
			"g: str = 'x'",
			"h: bool = True",
			"i: float = -1.5",
			"j: str = 7",
			"",
		].join("\n"),
	);
	fakes.fs.seedText("b.txt", "a: int = 'x'\n");
	const findings = await resolved.value.check(ctxFor(["a.py", "b.txt"]), {});
	assert.deepEqual(
		findings.map((f) => [f.path, f.line, f.message]),
		[
			["a.py", 3, "type error in a.py:3: int assigned 2.5"],
			["a.py", 5, "type error in a.py:5: bool assigned 1"],
			["a.py", 6, "type error in a.py:6: int assigned None"],
			["a.py", 10, "type error in a.py:10: str assigned 7"],
		],
	);
});

test("[§6.3] python/lint pins the names import statements bind", async () => {
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		{ id: "python/lint", kind: "code", budgetMs: 1000, args: {} },
		{ ...rule, id: "python/lint", enforcer: "python/lint" },
		fakes.ports,
	);
	assert.ok(resolved.ok && resolved.value !== undefined);
	if (!resolved.ok || resolved.value === undefined) {
		return;
	}
	fakes.fs.seedText(
		"i.py",
		[
			"import os, sys as system",
			"import a.b.c",
			"from m import (x, y as z)",
			"from . import w",
			"from q import *",
			"import used",
			"import 1bad",
			"used.go()",
			"",
		].join("\n"),
	);
	const findings = await resolved.value.check(ctxFor(["i.py"]), {});
	assert.deepEqual(
		findings.map((f) => [f.line, f.message]),
		[
			[1, "unused import os in i.py:1"],
			[1, "unused import system in i.py:1"],
			[2, "unused import a in i.py:2"],
			[3, "unused import x in i.py:3"],
			[3, "unused import z in i.py:3"],
			[4, "unused import w in i.py:4"],
		],
	);
});

import { strict as assert } from "node:assert";

import test from "node:test";

import {
	extractPythonImports,
	pythonExtractor,
} from "../../../src/builtin-packs/python/extract.ts";

import { pythonPack } from "../../../src/builtin-packs/python/index.ts";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { resolveCodeEnforcer } from "../../../src/features/packs/enforcers/code.ts";

import type { PackRule } from "../../../src/features/packs/index.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

function packRule(id: string): PackRule {
	return {
		id,
		family: "F3",
		tier: "floor",
		statement: "statement",
		reason: "reason",
		remediation: "fix {path}",
		enforcer: id,
		triggers: ["review"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: ["basic"], passing: ["basic"] },
	};
}

function codeDecl(id: string): EnforcerDecl {
	return { id, kind: "code", budgetMs: 1000, args: {} };
}

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "review",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

test("[§6.3] python extractor reports absolute and relative imports", () => {
	// SPEC §6.3: `import a.b`, `from a import b` and relative levels.
	// The entry shape mirrors the typescript extractor; the edges land with
	// the extractor.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.extractors, []);
	const extractor = pythonExtractor();
	assert.equal(extractor.language, "python");
	assert.deepEqual(extractor.extract("src/app/main.py", "x = 1\n"), []);
	assert.deepEqual(
		extractPythonImports(
			"src/app/main.py",
			"import os\nfrom app import worker\nfrom . import local\n",
		),
		[
			{ from: "src/app/main.py", to: "os", line: 1 },
			{ from: "src/app/main.py", to: "app", line: 2 },
			{ from: "src/app/main.py", to: ".", line: 3 },
		],
	);
});

test("[§6.3] python/typecheck violating/basic", async () => {
	// SPEC §6.3: mypy strict (or pyright strict) flags the untyped def. The
	// L1 approximation flags the annotated literal of the wrong type.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/typecheck"),
		packRule("python/typecheck"),
		fakes.ports,
	);
	assert.ok(resolved.ok);
	if (!resolved.ok) {
		return;
	}
	assert.ok(resolved.value !== undefined);
	if (resolved.value === undefined) {
		return;
	}
	fakes.fs.seedText("sample.py", 'age: int = "old"\n');
	const findings = await resolved.value.check(ctxFor(["sample.py"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "python/typecheck");
});

test("[§6.3] python/typecheck passing/basic", async () => {
	// SPEC §6.3: the fully annotated module stays clean under strict mode.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/typecheck"),
		packRule("python/typecheck"),
		fakes.ports,
	);
	assert.ok(resolved.ok);
	if (!resolved.ok) {
		return;
	}
	assert.ok(resolved.value !== undefined);
	if (resolved.value === undefined) {
		return;
	}
	fakes.fs.seedText("sample.py", "age: int = 30\n");
	const findings = await resolved.value.check(ctxFor(["sample.py"]), {});
	assert.deepEqual(findings, []);
});

test("[§6.3] python/lint violating/basic", async () => {
	// SPEC §6.3: ruff flags the unused import (select E, F, B, S, UP, I).
	// The L1 approximation flags the never-read import.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/lint"),
		packRule("python/lint"),
		fakes.ports,
	);
	assert.ok(resolved.ok);
	if (!resolved.ok) {
		return;
	}
	assert.ok(resolved.value !== undefined);
	if (resolved.value === undefined) {
		return;
	}
	fakes.fs.seedText("sample.py", 'import sys\n\nprint("hi")\n');
	const findings = await resolved.value.check(ctxFor(["sample.py"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "python/lint");
});

test("[§6.3] python/lint passing/basic", async () => {
	// SPEC §6.3: the clean module passes ruff check and format --check.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/lint"),
		packRule("python/lint"),
		fakes.ports,
	);
	assert.ok(resolved.ok);
	if (!resolved.ok) {
		return;
	}
	assert.ok(resolved.value !== undefined);
	if (resolved.value === undefined) {
		return;
	}
	fakes.fs.seedText("sample.py", "import sys\n\nprint(sys.argv)\n");
	const findings = await resolved.value.check(ctxFor(["sample.py"]), {});
	assert.deepEqual(findings, []);
});

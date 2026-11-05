import { strict as assert } from "node:assert";

import test from "node:test";

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

test("[§6.3] python/no-phantom-import violating/basic", async () => {
	// SPEC §6.3: a top-level import of an undeclared third-party package
	// is phantom; stdlib and first-party packages are not.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/no-phantom-import"),
		packRule("python/no-phantom-import"),
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
	fakes.fs.seedText("sample.py", "import phantom_pkg\n");
	fakes.fs.seedText("requirements.txt", "requests==2.31.0\n");
	const findings = await resolved.value.check(
		ctxFor(["sample.py", "requirements.txt"]),
		{},
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "python/no-phantom-import");
});

test("[§6.3] python/no-phantom-import passing/basic", async () => {
	// SPEC §6.3: stdlib, declared and first-party imports resolve clean.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/no-phantom-import"),
		packRule("python/no-phantom-import"),
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
	fakes.fs.seedText(
		"sample.py",
		"import os\nimport requests\nfrom helper import greet\n",
	);
	fakes.fs.seedText("helper.py", 'def greet():\n    return "hi"\n');
	fakes.fs.seedText("requirements.txt", "requests==2.31.0\n");
	const findings = await resolved.value.check(
		ctxFor(["sample.py", "helper.py", "requirements.txt"]),
		{},
	);
	assert.deepEqual(findings, []);
});

test("[§6.3] python/security-patterns violating/basic", async () => {
	// SPEC §6.3: eval, exec, subprocess with shell=True, pickle.loads,
	// unsafe yaml.load and verify=False are floor blocks.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/security-patterns"),
		packRule("python/security-patterns"),
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
	fakes.fs.seedText("sample.py", "result = exec(command)\n");
	const findings = await resolved.value.check(ctxFor(["sample.py"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "python/security-patterns");
});

test("[§6.3] python/security-patterns passing/basic", async () => {
	// SPEC §6.3: the module without sinks stays clean.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("python/security-patterns"),
		packRule("python/security-patterns"),
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
	fakes.fs.seedText("sample.py", "value = int(user_input)\n");
	const findings = await resolved.value.check(ctxFor(["sample.py"]), {});
	assert.deepEqual(findings, []);
});

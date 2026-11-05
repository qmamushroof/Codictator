import { strict as assert } from "node:assert";

import { readFileSync } from "node:fs";

import { dirname, join } from "node:path";

import test from "node:test";

import { fileURLToPath } from "node:url";

import { resolvePythonModule } from "../../../src/builtin-packs/python/extract.ts";

import { pythonPack } from "../../../src/builtin-packs/python/index.ts";

import { typescriptPack } from "../../../src/builtin-packs/typescript/index.ts";

import {
	classifyPyPiSpec,
	isExactPyPiPin,
} from "../../../src/features/deps/pypi.ts";

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

// SPEC §4.4.4: dangerous seed strings live in fixtures-as-data, never
// inline in the test body, so the self-host ts/security-patterns rule stays
// clean. The violating security-patterns fixture of each pack carries the
// sink sample this helper seeds.
const PACK_FIXTURE_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"src",
	"builtin-packs",
);

function securityFixtureSample(pack: string, name: string): string {
	const raw = readFileSync(
		join(
			PACK_FIXTURE_ROOT,
			pack,
			"fixtures",
			"security-patterns",
			"violating",
			"basic",
			"case.json",
		),
		"utf8",
	);
	const parsed = JSON.parse(raw) as { files?: Record<string, string> };
	const text = parsed.files?.[name];
	assert.ok(typeof text === "string", `missing ${name} in ${pack} fixture`);
	return text;
}

test("[§6.4 EC-7] python pack blocks ranged requirements pin", async () => {
	// SPEC §6.4 EC-7: block core/dep-exact-pin. The driver classifies the
	// range, and the pack-bound judging flags the requirements line while a
	// full `==x.y.z` pin stays clean.
	assert.equal(isExactPyPiPin(">=2"), false);
	assert.equal(classifyPyPiSpec(">=2"), "range");
	assert.equal(isExactPyPiPin("==2.31.0"), true);
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.drivers, []);
	assert.deepEqual(pack.manifest.rules, []);
	const fakes = createFakePorts();
	const resolved = resolveCodeEnforcer(
		codeDecl("core/dep-exact-pin"),
		packRule("core/dep-exact-pin"),
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
	fakes.fs.seedText("requirements.txt", "requests>=2\n");
	const ranged = await resolved.value.check(ctxFor(["requirements.txt"]), {});
	assert.equal(ranged.length, 1);
	assert.equal(ranged[0]?.ruleId, "core/dep-exact-pin");
	const clean = createFakePorts();
	const pinnedEnforcer = resolveCodeEnforcer(
		codeDecl("core/dep-exact-pin"),
		packRule("core/dep-exact-pin"),
		clean.ports,
	);
	assert.ok(pinnedEnforcer.ok);
	if (!pinnedEnforcer.ok) {
		return;
	}
	assert.ok(pinnedEnforcer.value !== undefined);
	if (pinnedEnforcer.value === undefined) {
		return;
	}
	clean.fs.seedText("requirements.txt", "requests==2.31.0\n");
	const pinned = await pinnedEnforcer.value.check(
		ctxFor(["requirements.txt"]),
		{},
	);
	assert.deepEqual(pinned, []);
});

test("[§6.4 EC-8] python pack resolves namespace package by directory", () => {
	// SPEC §6.4 EC-8: resolved by directory, no `__init__.py` needed. The
	// python import extractor lands with the directory resolver; a missing
	// module resolves to nothing.
	const pack = pythonPack();
	assert.equal(pack.manifest.id, "python");
	assert.deepEqual(pack.manifest.extractors, []);
	assert.equal(
		resolvePythonModule("app.worker", ["src/app/worker.py"]),
		"src/app/worker.py",
	);
	assert.equal(
		resolvePythonModule("app", ["src/app/worker.py"]),
		"src/app/worker.py",
	);
	assert.equal(
		resolvePythonModule("missing", ["src/app/worker.py"]),
		undefined,
	);
});

test("[§6.4 EC-10] python and typescript packs judge each file by its pack", async () => {
	// SPEC §6.4 EC-10: both packs load; each file judged by its pack. The
	// python sink fires on the `.py` file only, and the typescript sink on
	// the `.ts` file only.
	const python = pythonPack();
	const typescript = typescriptPack();
	assert.equal(python.manifest.id, "python");
	assert.equal(typescript.manifest.id, "typescript");
	assert.deepEqual(python.manifest.rules, []);
	const fakes = createFakePorts();
	const pyResolved = resolveCodeEnforcer(
		codeDecl("python/security-patterns"),
		packRule("python/security-patterns"),
		fakes.ports,
	);
	const tsResolved = resolveCodeEnforcer(
		codeDecl("ts/security-patterns"),
		packRule("ts/security-patterns"),
		fakes.ports,
	);
	assert.ok(pyResolved.ok && tsResolved.ok);
	if (!pyResolved.ok || !tsResolved.ok) {
		return;
	}
	assert.ok(pyResolved.value !== undefined && tsResolved.value !== undefined);
	if (pyResolved.value === undefined || tsResolved.value === undefined) {
		return;
	}
	fakes.fs.seedText("app.py", securityFixtureSample("python", "sample.py"));
	fakes.fs.seedText("app.ts", securityFixtureSample("typescript", "sample.ts"));
	const scope = ["app.py", "app.ts"];
	const pyFindings = await pyResolved.value.check(ctxFor(scope), {});
	assert.deepEqual(
		pyFindings.map((finding) => finding.path),
		["app.py"],
	);
	const tsFindings = await tsResolved.value.check(ctxFor(scope), {});
	assert.deepEqual(
		tsFindings.map((finding) => finding.path),
		["app.ts"],
	);
});

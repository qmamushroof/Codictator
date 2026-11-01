// SPEC §6.3 + §6.4 EC-7/EC-8/EC-10: red-first contracts for the step 12.4
// python pack. Every test pins its wiring-absent state first (no pack.json
// rules, drivers or extractors wired; no fixtures shipped), then fails on
// the not-yet-implemented pack supply, so each one executes and stays red
// until the extractor and pack-bound enforcers land. Nothing here wires
// into a dispatcher or registry; the stub is imported directly.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	extractPythonImports,
	pythonExtractor,
	resolvePythonModule,
} from "../../../src/builtin-packs/python/extract.ts";
import { pythonPack } from "../../../src/builtin-packs/python/index.ts";
import { typescriptPack } from "../../../src/builtin-packs/typescript/index.ts";
import {
	classifyPyPiSpec,
	isExactPyPiPin,
} from "../../../src/features/deps/pypi.ts";

test("[§6.4 EC-7] python pack blocks ranged requirements pin", () => {
	// SPEC §6.4 EC-7: block core/dep-exact-pin. The driver classifies the
	// range, but no pack-bound enforcer judges requirements files yet.
	assert.equal(isExactPyPiPin(">=2"), false);
	assert.equal(classifyPyPiSpec(">=2"), "range");
	assert.equal(isExactPyPiPin("==2.31.0"), true);
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.drivers, []);
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.4 EC-7 pack-bound exact-pin judging",
	);
});

test("[§6.4 EC-8] python pack resolves namespace package by directory", () => {
	// SPEC §6.4 EC-8: resolved by directory, no __init__.py needed. Red
	// until the python import extractor lands; the driver alone resolves
	// no module to a file.
	const pack = pythonPack();
	assert.equal(pack.manifest.id, "python");
	assert.deepEqual(pack.manifest.extractors, []);
	resolvePythonModule("app.worker", ["src/app/worker.py"]);
});

test("[§6.4 EC-10] python and typescript packs judge each file by its pack", () => {
	// SPEC §6.4 EC-10: both packs load; each file judged by its pack. Red
	// until pack-bound enforcers land; loading both packs alone judges no
	// file.
	const python = pythonPack();
	const typescript = typescriptPack();
	assert.equal(python.manifest.id, "python");
	assert.equal(typescript.manifest.id, "typescript");
	assert.deepEqual(python.manifest.rules, []);
	throw new Error("not implemented: SPEC §6.4 EC-10 per-file pack judging");
});

test("[§6.3] python extractor reports absolute and relative imports", () => {
	// SPEC §6.3: `import a.b`, `from a import b` and relative levels.
	// The entry shape mirrors the typescript extractor; the edges land
	// with the extractor.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.extractors, []);
	pythonExtractor();
	extractPythonImports(
		"src/app/main.py",
		"import os\nfrom app import worker\nfrom . import local\n",
	);
});

test("[§6.3] python/typecheck violating/basic", () => {
	// SPEC §6.3: mypy strict (or pyright strict) flags the untyped def.
	// No rule or fixture is wired yet.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/typecheck fixtures and enforcer",
	);
});

test("[§6.3] python/typecheck passing/basic", () => {
	// SPEC §6.3: the fully annotated module stays clean under strict mode.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/typecheck fixtures and enforcer",
	);
});

test("[§6.3] python/lint violating/basic", () => {
	// SPEC §6.3: ruff flags the unused import (select E, F, B, S, UP, I).
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/lint fixtures and enforcer",
	);
});

test("[§6.3] python/lint passing/basic", () => {
	// SPEC §6.3: the clean module passes ruff check and format --check.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/lint fixtures and enforcer",
	);
});

test("[§6.3] python/no-phantom-import violating/basic", () => {
	// SPEC §6.3: a top-level import of an undeclared third-party package
	// is phantom; stdlib and first-party packages are not.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/no-phantom-import fixtures and enforcer",
	);
});

test("[§6.3] python/no-phantom-import passing/basic", () => {
	// SPEC §6.3: stdlib, declared and first-party imports resolve clean.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/no-phantom-import fixtures and enforcer",
	);
});

test("[§6.3] python/security-patterns violating/basic", () => {
	// SPEC §6.3: eval, exec, subprocess with shell=True, pickle.loads,
	// unsafe yaml.load and verify=False are floor blocks.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/security-patterns fixtures and enforcer",
	);
});

test("[§6.3] python/security-patterns passing/basic", () => {
	// SPEC §6.3: the module without sinks stays clean.
	const pack = pythonPack();
	assert.deepEqual(pack.manifest.rules, []);
	throw new Error(
		"not implemented: SPEC §6.3 python/security-patterns fixtures and enforcer",
	);
});

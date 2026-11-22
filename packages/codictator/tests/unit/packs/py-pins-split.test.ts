// SPEC §6.3 driver `pypi`: characterisation of the pyproject dependency scan.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as pyPins from "../../../src/features/packs/enforcers/py-pins.ts";

test("[§6.3] pyproject array reader collects quoted names and skips include-group rows", () => {
	assert.deepEqual(pyPins.readQuotedNames(`"requests>=2", 'flask[extra]==1'`), [
		"requests",
		"flask",
	]);
	assert.deepEqual(pyPins.readQuotedNames(`"", "{include-group = 'dev'}"`), []);
	assert.deepEqual(pyPins.readQuotedNames(`"-e ."`), []);
});

test("[§6.3] pyproject scan reads project, group and optional arrays only", () => {
	const text = [
		"[project]",
		'name = "demo"',
		"dependencies = [",
		'  "requests>=2",',
		'  "numpy==1.2.3",',
		"]",
		"[project.optional-dependencies]",
		'extra = ["flask"]',
		"[dependency-groups]",
		"dev = [",
		'  "pytest",',
		'  {include-group = "lint"},',
		"]",
		"[tool.other]",
		'deps = ["ignored"]',
	].join("\n");
	assert.deepEqual([...pyPins.collectPyprojectNames(text)].sort(), [
		"flask",
		"numpy",
		"pytest",
		"requests",
	]);
	assert.deepEqual(
		[
			...pyPins.collectPyprojectNames(
				'[project]\ndependencies = ["a", ["b"]]\nx = ["c"]',
			),
		].sort(),
		["a", "b"],
	);
	assert.deepEqual([...pyPins.collectPyprojectNames("")], []);
});

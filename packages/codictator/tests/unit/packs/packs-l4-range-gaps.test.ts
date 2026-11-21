// SPEC §4.10.4 + §4.4.4 (BUG-0110): the L4 range judges of
// core/no-threshold-lowering (the coverage-threshold keys table) and
// core/custom-pack-selftest (a configured custom pack whose self-test fails
// or whose acceptance went stale); without a range base both add nothing.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	configWithCustom,
	customPackFiles,
	staleAcceptance,
} from "../../support/custom-pack-fixture.ts";
import { ids, runRange } from "../../support/l3-live-scenario.ts";

const RULE = "core/no-threshold-lowering";

function jestPackage(lines: number): string {
	return JSON.stringify({
		name: "a",
		jest: { coverageThreshold: { global: { lines, branches: 70 } } },
	});
}

test("[§4.10.4] L4 no-threshold-lowering flags a lowered package.json jest coverageThreshold and stays quiet without a range base", async () => {
	const found = await runRange(
		RULE,
		{ "package.json": jestPackage(90) },
		{ "package.json": jestPackage(80) },
	);
	assert.deepEqual(ids(found), [RULE]);
	assert.equal(found[0]?.path, "package.json");
	assert.ok(
		found[0]?.message.includes("coverageThreshold.global.lines"),
		found[0]?.message,
	);
	const local = await runRange(RULE, undefined, {
		"package.json": jestPackage(80),
	});
	assert.deepEqual(local, []);
});

test("[§4.10.4] L4 no-threshold-lowering reads vitest and jest config files, pyproject.toml and .coveragerc", async () => {
	const vitest = (n: number): string =>
		`import { defineConfig } from "vitest/config";\nexport default defineConfig({\n  test: {\n    coverage: {\n      thresholds: { lines: ${n}, functions: 80 },\n    },\n  },\n});\n`;
	const jest = (n: number): string =>
		`module.exports = {\n  coverageThreshold: {\n    global: { branches: ${n} },\n    "./src/": { lines: 90 },\n  },\n};\n`;
	const pyproject = (n: number): string =>
		`[project]\nname = "a"\n\n[tool.coverage.report]\nfail_under = ${n}\nshow_missing = true\n`;
	const rc = (n: number): string =>
		`[run]\nbranch = True\n\n[report]\nfail_under: ${n}\n`;
	const found = await runRange(
		RULE,
		{
			"vitest.config.ts": vitest(85),
			"jest.config.js": jest(75),
			"pyproject.toml": pyproject(90),
			".coveragerc": rc(88.5),
		},
		{
			"vitest.config.ts": vitest(84),
			"jest.config.js": jest(60),
			"pyproject.toml": pyproject(50),
			".coveragerc": rc(80),
		},
	);
	assert.deepEqual(found.map((finding) => finding.path).sort(), [
		".coveragerc",
		"jest.config.js",
		"pyproject.toml",
		"vitest.config.ts",
	]);
	assert.deepEqual([...new Set(ids(found))], [RULE]);
});

test("[§4.10.4] L4 no-threshold-lowering stays quiet when a threshold is raised or unchanged, and flags a removed one", async () => {
	const pyproject = (body: string): string =>
		`[tool.coverage.report]\n${body}\n\n[tool.other]\nfail_under = 1\n`;
	const raised = await runRange(
		RULE,
		{
			"package.json": jestPackage(80),
			"pyproject.toml": pyproject("fail_under = 80"),
		},
		{
			"package.json": jestPackage(95),
			"pyproject.toml": pyproject("fail_under = 80"),
		},
	);
	assert.deepEqual(raised, []);
	const removed = await runRange(
		RULE,
		{ "pyproject.toml": pyproject("fail_under = 80") },
		{ "pyproject.toml": pyproject("show_missing = true") },
	);
	assert.deepEqual(ids(removed), [RULE]);
});

const SELFTEST = "core/custom-pack-selftest";
const CONFIG = ".codictator/config.json";

test("[§4.4.8 EC-2] L4 custom-pack-selftest flags a configured custom pack whose self-test fails", async () => {
	const head = { [CONFIG]: configWithCustom(), ...customPackFiles(5) };
	const found = await runRange(
		SELFTEST,
		{ [CONFIG]: configWithCustom() },
		head,
	);
	assert.deepEqual(ids(found), [SELFTEST]);
	assert.ok(found[0]?.message.includes("CDX-E212"), found[0]?.message);
	const local = await runRange(SELFTEST, undefined, head);
	assert.deepEqual(local, []);
});

test("[§4.4.8 EC-4] L4 custom-pack-selftest flags a custom pack edited after acceptance and stays quiet for a healthy one", async () => {
	const healthy = { [CONFIG]: configWithCustom(), ...customPackFiles(320) };
	const quiet = await runRange(SELFTEST, { [CONFIG]: "{}" }, healthy);
	assert.deepEqual(quiet, []);
	const stale = await runRange(
		SELFTEST,
		{ [CONFIG]: "{}" },
		{ ...healthy, ...staleAcceptance() },
	);
	assert.deepEqual(ids(stale), [SELFTEST]);
	assert.ok(stale[0]?.message.includes("mypack"), stale[0]?.message);
});

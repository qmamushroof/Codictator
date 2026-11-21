// SPEC §4.15.1 (BUG-0108): the L4 range judges over the repo state a range
// change touches: test command, baseline, architecture profile, waivers,
// perf command and the generated workflow.
import { strict as assert } from "node:assert";
import test from "node:test";
import { ids, runRange } from "../../support/l3-live-scenario.ts";

const CONFIG = ".codictator/config.json";

function pkg(script: string): string {
	return JSON.stringify({ name: "a", scripts: { test: script } });
}

test("[§4.10.4] L4 test-command-intact flags a test script that gains || true", async () => {
	const found = await runRange(
		"core/test-command-intact",
		{ "package.json": pkg("node --test") },
		{ "package.json": pkg("node --test || true") },
	);
	assert.deepEqual(ids(found), ["core/test-command-intact"]);
});

test("[§4.10.4] L4 test-command-intact accepts a weakener the base command already carried", async () => {
	const found = await runRange(
		"core/test-command-intact",
		{ "package.json": pkg("node --test || true") },
		{ "package.json": pkg("node --test --x || true") },
	);
	assert.deepEqual(found, []);
});

function baseline(count: number): string {
	return JSON.stringify({
		version: 1,
		entries: { "r@1": { "src/a.ts": count } },
	});
}

test("[§4.3.5] L4 no-baseline-raise flags a raised key and accepts a lowered one", async () => {
	const file = ".codictator/baseline.json";
	const raised = await runRange(
		"core/no-baseline-raise",
		{ [file]: baseline(1) },
		{ [file]: baseline(3) },
	);
	assert.deepEqual(ids(raised), ["core/no-baseline-raise"]);
	const lowered = await runRange(
		"core/no-baseline-raise",
		{ [file]: baseline(3) },
		{ [file]: baseline(1) },
	);
	assert.deepEqual(lowered, []);
});

test("[§4.11.4] L4 arch-profile-declared flags a changed config with no profile and a module kind the profile forbids", async () => {
	const none = await runRange(
		"core/arch-profile-declared",
		{},
		{
			[CONFIG]: JSON.stringify({ version: 1, packs: [] }),
		},
	);
	assert.deepEqual(ids(none), ["core/arch-profile-declared"]);
	const architecture = {
		profile: "library",
		modules: [{ name: "a", path: "src/**", kind: "feature", dependsOn: [] }],
	};
	const kind = await runRange(
		"core/arch-profile-declared",
		{},
		{
			[CONFIG]: JSON.stringify({ version: 1, packs: [], architecture }),
		},
	);
	assert.deepEqual(ids(kind), ["core/arch-profile-declared"]);
	assert.match(kind[0]?.message ?? "", /invalid for profile library/);
});

function waivers(created: string, expires: string): string {
	return JSON.stringify({
		version: 1,
		waivers: [
			{
				id: "W-0001",
				rule: "core/function-size",
				params: { maxLines: 60 },
				reason: "legacy parser awaiting its planned split",
				created,
				expires,
				createdBy: "human",
			},
		],
	});
}

test("[§4.3.4] L4 waivers-valid flags an expired waiver and accepts a live one", async () => {
	const file = ".codictator/waivers.json";
	const now = "2026-03-01T00:00:00.000Z";
	const expired = await runRange(
		"core/waivers-valid",
		{},
		{ [file]: waivers("2026-01-01", "2026-02-01") },
		now,
	);
	assert.deepEqual(ids(expired), ["core/waivers-valid"]);
	const live = await runRange(
		"core/waivers-valid",
		{},
		{ [file]: waivers("2026-02-15", "2026-04-01") },
		now,
	);
	assert.deepEqual(live, []);
});

test("[§4.15.2] L4 perf-budgets flags a test budget comment with no perf command and accepts one with it", async () => {
	const file = "tests/a.test.ts";
	const budgeted = '// codictator:budget p95 <= 100\ntest("a", () => {});\n';
	const missing = await runRange("core/perf-budgets", {}, { [file]: budgeted });
	assert.deepEqual(ids(missing), ["core/perf-budgets"]);
	const wired = await runRange(
		"core/perf-budgets",
		{},
		{
			[file]: budgeted,
			[CONFIG]: JSON.stringify({ commands: { perf: ["npm", "run", "perf"] } }),
		},
	);
	assert.deepEqual(wired, []);
});

test("[§4.15.2] L4 ci-present flags a changed generated workflow with no verify job", async () => {
	const file = ".github/workflows/codictator.yml";
	const found = await runRange(
		"core/ci-present",
		{},
		{
			[file]: "jobs:\n  lint:\n    runs-on: ubuntu-latest\n",
		},
	);
	assert.deepEqual(ids(found), ["core/ci-present"]);
	const kept = await runRange(
		"core/ci-present",
		{},
		{
			[file]: "jobs:\n  verify:\n    runs-on: ubuntu-latest\n",
		},
	);
	assert.deepEqual(kept, []);
});

import { strict as assert } from "node:assert";

import test from "node:test";

import type { Enforcer, Finding } from "../../../src/features/engine/index.ts";

import type { Pack, PackRule } from "../../../src/features/packs/index.ts";

import { loadPack, selfTest } from "../../../src/features/packs/index.ts";

function packRule(
	id: string,
	violating: ReadonlyArray<string>,
	passing: ReadonlyArray<string>,
): PackRule {
	return {
		id,
		family: "F2",
		tier: "tunable",
		statement: "statement",
		reason: "reason",
		remediation: "remediation",
		enforcer: "check",
		triggers: ["startup"],
		scope: ["src/**/*.ts"],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [...violating], passing: [...passing] },
	};
}

function testPack(
	id: string,
	rules: ReadonlyArray<PackRule>,
	enforcers: ReadonlyArray<Enforcer>,
): Pack {
	return {
		manifest: {
			id,
			version: "0.0.0",
			description: "test pack",
			rules: [...rules],
			enforcers: [],
			drivers: [],
			extractors: [],
			measures: [],
			capabilities: [],
			assets: [],
			maxWaiverDays: 90,
		},
		enforcers: [...enforcers],
		drivers: [],
		assets: [],
	};
}

function stubEnforcer(findings: ReadonlyArray<Finding>): Enforcer {
	return {
		id: "core/x",
		kinds: ["startup"],
		budgetMs: 1000,
		check: async (): Promise<Array<Finding>> => [...findings],
	};
}

test("[§4.4 EC-13] two language packs claim one extension", async () => {
	// SPEC §4.4.8 EC-13: the first pack in config.packs wins; status reports it.
	const result = await loadPack("repo-ts-py-overlap");
	assert.equal(result.ok, true);
});

test("[§4.4 EC-1] rule without a violating fixture", async () => {
	// SPEC §4.4.8 EC-1: load fails CDX-E211.
	const pack = testPack("core", [packRule("core/x", [], ["basic"])], []);
	const result = await selfTest(pack);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E211");
	}
});

test("[§4.4 EC-2] violating fixture passes", async () => {
	// SPEC §4.4.8 EC-2: CDX-E212, the pack is inert.
	const pack = testPack(
		"core",
		[packRule("core/x", ["basic"], ["basic"])],
		[stubEnforcer([])],
	);
	const result = await selfTest(pack);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E212");
	}
});

test("[§4.4 EC-3] passing fixture blocked", async () => {
	// SPEC §4.4.8 EC-3: CDX-E213, the pack is inert.
	const pack = testPack(
		"core",
		[packRule("core/x", ["basic"], ["basic"])],
		[stubEnforcer([{ ruleId: "core/x", message: "m", remediation: "r" }])],
	);
	const result = await selfTest(pack);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E213");
	}
});

test("[§4.4 EC-4] custom pack edited after acceptance", async () => {
	// SPEC §4.4.8 EC-4: inert at L1-L3 with an advise naming it;
	// L4 blocks core/custom-pack-selftest.
	const result = await loadPack("custom-packs/edited-after-accept");
	assert.equal(result.ok, false);
});

test("[§4.4 EC-5] custom rule id under the core namespace", async () => {
	// SPEC §4.4.8 EC-5: CDX-E204.
	// SPEC §4.10.4 integrity note: same EC, same code asserted; the test now
	// loads the real custom-packs/core-id fixture whose rule id core/x sits
	// outside its own namespace, so a failure still proves the EC-5 check.
	const result = await loadPack("custom-packs/core-id");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E204");
	}
});

test("[§4.4 EC-6] external tool mapped to core/no-secrets", async () => {
	// SPEC §4.4.8 EC-6: CDX-E210.
	const result = await loadPack("custom-packs/external-maps-core");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E210");
	}
});

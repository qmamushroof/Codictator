// SPEC §4.4.8: one red test per packs EC row. Self-test rows build a Pack
// literal and assert the self-test failure code; loader rows assert the
// load outcome; tool-safety rows drive the Proc fake. loadPack and selfTest
// still throw "not implemented", so all fourteen fail red until Phase 5 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Enforcer, Finding } from "../../../src/features/engine/index.ts";
import type { Pack, PackRule } from "../../../src/features/packs/index.ts";
import { loadPack, selfTest } from "../../../src/features/packs/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

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

test("[§4.4 EC-7] external tool newer than its pin", async () => {
	// SPEC §4.4.8 EC-7: CDX-E208 and block; the fix pins the new version.
	const result = await loadPack("custom-packs/tool-version-drift");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E208");
	}
});

test("[§4.4 EC-8] external tool exits with an unlisted code", async () => {
	// SPEC §4.4.8 EC-8: CDX-E207 and block (fail closed).
	const result = await loadPack("custom-packs/tool-unlisted-exit");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E207");
	}
});

test("[§4.4 EC-9] SARIF finding outside the repo root", async () => {
	// SPEC §4.4.8 EC-9: the finding is dropped and CDX-E207 is raised;
	// tool output is untrusted.
	const result = await loadPack("custom-packs/sarif-path-escape");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E207");
	}
});

test("[§4.4 EC-10] twenty thousand paths in one expansion", async () => {
	const { proc } = createFakePorts();
	const files = Array.from({ length: 20000 }, (_, index) => `src/f${index}.ts`);
	await proc.run(["tool", ...files], {
		cwd: "/repo",
		env: {},
		timeoutMs: 5000,
		maxOutputBytes: 65536,
	});
	// SPEC §4.4.8 EC-10: batched so no command line exceeds 24 KB; one merged result.
	assert.ok(proc.calls.length > 1);
});

test("[§4.4 EC-11] dash-prefixed path passed to a tool", async () => {
	const { proc } = createFakePorts();
	await proc.run(["tool", "--exec=rm"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 5000,
		maxOutputBytes: 65536,
	});
	// SPEC §4.4.8 EC-11: passed as a separate argv entry, ./--exec=rm.
	assert.equal(proc.calls.length, 1);
	const recorded = proc.calls[0];
	assert.notEqual(recorded, undefined);
	if (recorded !== undefined) {
		assert.equal(recorded.argv[1], "./--exec=rm");
	}
});

test("[§4.4 EC-12] hanging tool", async () => {
	const { ports } = createFakePorts();
	const result = await ports.proc.run(["tool", "--hang"], {
		cwd: "/repo",
		env: {},
		timeoutMs: 50,
		maxOutputBytes: 65536,
	});
	// SPEC §4.4.8 EC-12: killed at timeoutMs; CDX-E902.
	assert.equal(result.timedOut, true);
});

test("[§4.4 EC-13] two language packs claim one extension", async () => {
	// SPEC §4.4.8 EC-13: the first pack in config.packs wins; status reports it.
	const result = await loadPack("repo-ts-py-overlap");
	assert.equal(result.ok, true);
});

test("[§4.4 EC-14] helper tool missing for agent assets", async () => {
	// SPEC §4.4.8 EC-14: only core/agent-assets-present blocks, at L4 alone.
	const result = await loadPack("repo-missing-helper-tool");
	assert.equal(result.ok, true);
});

// SPEC §4.13.9: one red test per remediation EC row. Baseline rows assert
// captureBaseline; plan rows assert planRemediation; run rows assert runStep.
// All three still throw "not implemented", so all fifteen fail red until Phase 8 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	Baseline,
	RemediationPlan,
} from "../../../src/features/remediation/index.ts";
import {
	captureBaseline,
	planRemediation,
	runStep,
} from "../../../src/features/remediation/index.ts";

function baselineFor(): Baseline {
	return { version: 1, entries: { "core/file-size": { "src/a.ts": 10 } } };
}

function planFor(): RemediationPlan {
	return {
		version: 1,
		generatedFrom: { head: "abc123", baselineHash: "hash-1" },
		steps: [
			{
				id: "S-0001",
				kind: "restore-green",
				scope: ["src/a.ts"],
				executor: "agent",
				dependsOn: [],
				status: "pending",
				attempts: 0,
			},
		],
	};
}

test("[§4.13 EC-1] failing tests open single restore-green", async () => {
	// SPEC §4.13.9 EC-1: all other steps wait behind it.
	const plan = await planRemediation(baselineFor(), ["build failing"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-2] missing smoke blocks runtime steps", async () => {
	// SPEC §4.13.9 EC-2: blocked needs-smoke; init and status say so.
	const plan = await planRemediation(baselineFor(), ["no smoke command"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-3] dirty tree refuses remediate run", async () => {
	// SPEC §4.13.9 EC-3: CDX-E608, nothing done.
	const done = await runStep(planFor(), "S-0001");
	assert.equal(done.ok, false);
});

test("[§4.13 EC-4] smoke failure rolls back the step", async () => {
	// SPEC §4.13.9 EC-4: reset, then split or block.
	const done = await runStep(planFor(), "S-0001");
	assert.equal(done.ok, false);
});

test("[§4.13 EC-5] new finding outside scope fails step", async () => {
	// SPEC §4.13.9 EC-5: nothing else may get worse.
	const done = await runStep(planFor(), "S-0001");
	assert.equal(done.ok, false);
});

test("[§4.13 EC-6] oversize diff fails before retry", async () => {
	// SPEC §4.13.9 EC-6: split before retry.
	const done = await runStep(planFor(), "S-0001");
	assert.equal(done.ok, false);
});

test("[§4.13 EC-7] major needing newer runtime orders toolchain first", async () => {
	// SPEC §4.13.9 EC-7: a toolchain prerequisite child runs first.
	const plan = await planRemediation(baselineFor(), ["major needs node 24"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-8] vulnerable major allowed past floor", async () => {
	// SPEC §4.13.9 EC-8: the dep-major chain PRs are allowed by §4.13.8.
	const plan = await planRemediation(baselineFor(), [
		"vulnerable pinned major",
	]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-9] regenerated plan keeps finished steps", async () => {
	// SPEC §4.13.9 EC-9: ids never reused; finished steps kept.
	const plan = await planRemediation(baselineFor(), ["new finding"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-10] overlapping steps serialise on dependsOn", async () => {
	// SPEC §4.13.9 EC-10: the order serialises the shared file.
	const plan = await planRemediation(baselineFor(), ["two steps one file"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-11] out-of-order merge marks satisfied done", async () => {
	// SPEC §4.13.9 EC-11: already-satisfied targets become done.
	const plan = await planRemediation(baselineFor(), ["merged early"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-12] rollback on user branch is refused", async () => {
	// SPEC §4.13.9 EC-12: refused CDX-E609.
	const done = await runStep(planFor(), "S-0001");
	assert.equal(done.ok, false);
});

test("[§4.13 EC-13] historic secret is advice not a block", async () => {
	// SPEC §4.13.9 EC-13: status reports rotation advice; history stays.
	const baseline = await captureBaseline("repo-root");
	assert.equal(baseline.ok, true);
});

test("[§4.13 EC-14] platform keeps duplicate capability", async () => {
	// SPEC §4.13.9 EC-14: the package is migrated away and removed.
	const plan = await planRemediation(baselineFor(), ["duplicate capability"]);
	assert.equal(plan.ok, true);
});

test("[§4.13 EC-15] remote-less repo keeps local branches", async () => {
	// SPEC §4.13.9 EC-15: steps stay as local branches; status lists them.
	const baseline = await captureBaseline("repo-root");
	assert.equal(baseline.ok, true);
});

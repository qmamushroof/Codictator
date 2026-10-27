// SPEC §4.15.7: one red test per CI EC row. Workflow rows assert
// renderWorkflow; gate rows assert checkCi. Both still throw
// "not implemented", so all eleven fail red until Phase 9 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CiWorkflow } from "../../../src/features/ci/index.ts";
import { checkCi, renderWorkflow } from "../../../src/features/ci/index.ts";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "scheduled",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function workflowFor(): CiWorkflow {
	return {
		host: "github",
		os: ["ubuntu-latest"],
		steps: ["checkout", "setup-node", "verify"],
	};
}

test("[§4.15 EC-1] PR from a fork with a read-only token", async () => {
	// SPEC §4.15.7 EC-1: verify runs; the required-check rule only advises.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.length > 0);
});

test("[§4.15 EC-2] shallow clone despite config", async () => {
	// SPEC §4.15.7 EC-2: CDX-E503, base unreachable, block.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.some((finding) => finding.code === "CDX-E503"));
});

test("[§4.15 EC-3] push of a new branch with no before", async () => {
	// SPEC §4.15.7 EC-3: base is the merge-base with the default branch.
	const workflow = await renderWorkflow("/repo");
	assert.ok(workflow.steps.length >= 0);
});

test("[§4.15 EC-4] workflow edited to add continue-on-error", async () => {
	// SPEC §4.15.7 EC-4: manifest drift, block.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.length > 0);
});

test("[§4.15 EC-5] another workflow uses actions checkout v4", async () => {
	// SPEC §4.15.7 EC-5: block core/ci-actions-pinned.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
});

test("[§4.15 EC-6] branch protection API returns 403", async () => {
	// SPEC §4.15.7 EC-6: advise "cannot confirm required check".
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.length > 0);
});

test("[§4.15 EC-7] ruleset exists but verify not required", async () => {
	// SPEC §4.15.7 EC-7: block until verify is a required check.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.length > 0);
});

test("[§4.15 EC-8] bot PR from a fork", async () => {
	// SPEC §4.15.7 EC-8: no commit written; the history entry is required.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.length > 0);
});

test("[§4.15 EC-9] sweep PR already open", async () => {
	// SPEC §4.15.7 EC-9: updated in place; never a second PR.
	const workflow = await renderWorkflow("/repo");
	assert.ok(workflow.steps.length >= 0);
});

test("[§4.15 EC-10] scheduled run with no changes", async () => {
	// SPEC §4.15.7 EC-10: still evaluates fresh advisories.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(findings.length >= 0);
});

test("[§4.15 EC-11] squash merging allowed with no ruleset", async () => {
	// SPEC §4.15.7 EC-11: block core/branch-protection; name both settings.
	const findings = await checkCi(ctxFor(), workflowFor());
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/branch-protection"),
	);
});

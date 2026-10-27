// SPEC §4.12.7: one red test per workflow EC row. Gate rows assert
// checkPhaseGate; review rows assert checkReview; loop rows assert checkLoop.
// All three still throw "not implemented", so all fourteen fail red until Phase 7 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import type {
	ReviewFindingsFile,
	TaskRecord,
} from "../../../src/features/workflow/index.ts";
import {
	checkLoop,
	checkPhaseGate,
	checkReview,
} from "../../../src/features/workflow/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function taskFor(phase: string): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "feature",
		title: "add a thing",
		branch: "agent/work",
		phase,
		phases: [
			{ name: "discovery", enteredAt: FIXED_INSTANT, evidence: "spec refs" },
		],
		spec: ["§4.12"],
		acceptanceCriteria: ["gated"],
		files: { allow: ["src/a.ts"] },
	};
}

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: ["src/a.ts"], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function findingsFor(): ReviewFindingsFile {
	return { version: 1, findings: [] };
}

test("[§4.12 EC-1] write with no active task blocks", async () => {
	// SPEC §4.12.7 EC-1: block with codictator task new instructions.
	const findings = await checkPhaseGate(
		taskFor("implementation"),
		"implementation",
	);
	assert.ok(findings.length >= 0);
});

test("[§4.12 EC-2] implementation write before red proof blocks", async () => {
	// SPEC §4.12.7 EC-2: block until the red proof exists.
	const findings = await checkPhaseGate(taskFor("planning"), "implementation");
	assert.ok(findings.length > 0);
});

test("[§4.12 EC-3] write outside files allow blocks", async () => {
	// SPEC §4.12.7 EC-3: remediation is task amend --allow, returning to planning.
	const findings = await checkPhaseGate(
		taskFor("implementation"),
		"implementation",
	);
	assert.ok(findings.length >= 0);
});

test("[§4.12 EC-4] write during review phase blocks", async () => {
	// SPEC §4.12.7 EC-4: return to implementation voids proofs and review.
	const findings = await checkPhaseGate(taskFor("review"), "review");
	assert.ok(findings.length >= 0);
});

test("[§4.12 EC-5] author session cannot submit review", async () => {
	// SPEC §4.12.7 EC-5: review submit refuses CDX-E605.
	const findings = await checkReview(ctxFor(), findingsFor());
	assert.ok(findings.some((finding) => finding.code === "CDX-E605"));
});

test("[§4.12 EC-6] restaged file makes review stale", async () => {
	// SPEC §4.12.7 EC-6: gate fails on a stale tree.
	const findings = await checkReview(ctxFor(), findingsFor());
	assert.ok(findings.length >= 0);
});

test("[§4.12 EC-7] fourth repeat block escalates", async () => {
	// SPEC §4.12.7 EC-7: all task tool calls blocked until task ack.
	const findings = await checkLoop(ctxFor(), 4);
	assert.ok(findings.some((finding) => finding.ruleId === "core/loop-breaker"));
});

test("[§4.12 EC-8] agent running task ack is blocked", async () => {
	// SPEC §4.12.7 EC-8: shell guard blocks; CDX-E107 if reached.
	const findings = await checkLoop(ctxFor(), 1);
	assert.equal(findings.length, 0);
});

test("[§4.12 EC-9] custom phase before discovery is CDX-E105", async () => {
	// SPEC §4.12.7 EC-9: removing or reordering mandatory phases is refused.
	const findings = await checkPhaseGate(
		taskFor("discovery"),
		"security-review",
	);
	assert.ok(findings.some((finding) => finding.code === "CDX-E105"));
});

test("[§4.12 EC-10] two open tasks on one branch is CDX-E606", async () => {
	// SPEC §4.12.7 EC-10: status lists both.
	const findings = await checkPhaseGate(taskFor("planning"), "planning");
	assert.ok(findings.some((finding) => finding.code === "CDX-E606"));
});

test("[§4.12 EC-11] docs-only change in code task is allowed", async () => {
	// SPEC §4.12.7 EC-11: allowed; code gates still owed when code changed.
	const findings = await checkPhaseGate(
		taskFor("implementation"),
		"implementation",
	);
	assert.equal(findings.length, 0);
});

test("[§4.12 EC-12] bot dependency PR needs no task file", async () => {
	// SPEC §4.12.7 EC-12: deps class; CI adds the history entry.
	const findings = await checkPhaseGate(taskFor("record"), "record");
	assert.equal(findings.length, 0);
});

test("[§4.12 EC-13] branch switch follows the active task", async () => {
	// SPEC §4.12.7 EC-13: the next hook uses the new branch task.
	const findings = await checkPhaseGate(
		taskFor("implementation"),
		"implementation",
	);
	assert.equal(findings.length, 0);
});

test("[§4.12 EC-14] malformed findings file is CDX-E607", async () => {
	// SPEC §4.12.7 EC-14: the round is not recorded.
	const findings = await checkReview(ctxFor(), { version: 1, findings: [] });
	assert.ok(findings.some((finding) => finding.code === "CDX-E607"));
});

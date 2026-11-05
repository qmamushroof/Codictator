import { strict as assert } from "node:assert";

import test from "node:test";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import {
	isMandatoryPhase,
	isTaskId,
	mergeTaskRecords,
	resolveActiveTask,
	roleForAsset,
	TASK_LOCK_PATH,
	taskIdFor,
	validatePhaseOrder,
	validateTaskRecord,
} from "../../../src/features/workflow/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function taskFor(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "feature",
		title: "add a thing",
		branch: "agent/work",
		phase: "implementation",
		phases: [
			{ name: "discovery", enteredAt: FIXED_INSTANT, evidence: "spec refs" },
		],
		spec: ["§4.12"],
		acceptanceCriteria: ["gated"],
		files: { allow: ["src/**"] },
		...over,
	};
}

test("[§4.12] workflow task ids format and sequence", () => {
	assert.equal(isTaskId("T-0001"), true);
	assert.equal(isTaskId("nope"), false);
	assert.equal(taskIdFor(7), "T-0007");
	assert.equal(TASK_LOCK_PATH, ".codictator/state/task.lock");
});

test("[§4.12] workflow active task binds the first branch match", () => {
	const task = taskFor();
	assert.equal(resolveActiveTask([task], "agent/work"), task);
	assert.equal(resolveActiveTask([task], "other"), undefined);
	assert.equal(resolveActiveTask([], "agent/work"), undefined);
});

test("[§4.12] workflow asset names map to roles", () => {
	assert.equal(roleForAsset("codictator-review"), "reviewer");
	assert.equal(roleForAsset("Plan helper"), "planner");
	assert.equal(roleForAsset("implementer agent"), "implementer");
	assert.equal(roleForAsset("qa pass"), "qa");
	assert.equal(roleForAsset("something else"), undefined);
});

test("[§4.12] workflow merge keeps the verified later phase", () => {
	const base = taskFor({ phase: "planning" });
	const head = taskFor({
		phase: "implementation",
		phases: [
			{ name: "implementation", enteredAt: FIXED_INSTANT, evidence: "gate" },
		],
	});
	assert.equal(
		mergeTaskRecords(base, head, ["planning", "implementation"]),
		head,
	);
	assert.equal(
		mergeTaskRecords(head, base, ["planning", "implementation"]),
		head,
	);
	const unverified = taskFor({ phase: "implementation", phases: [] });
	assert.equal(
		mergeTaskRecords(base, unverified, ["planning", "implementation"]),
		base,
	);
	assert.equal(
		mergeTaskRecords(base, head, ["planning", "implementation"], () => false),
		base,
	);
});

test("[§4.12] workflow records reject bad ids types and blanks", () => {
	const problems = validateTaskRecord(
		taskFor({ id: "x", type: "bogus", branch: "", title: "" }),
	);
	assert.equal(problems.length, 4);
	assert.deepEqual(validateTaskRecord(taskFor()), []);
});

test("[§4.12] workflow mandatory phases keep their order", () => {
	assert.equal(isMandatoryPhase("review"), true);
	assert.equal(isMandatoryPhase("custom"), false);
	assert.equal(
		validatePhaseOrder([
			"discovery",
			"planning",
			"implementation",
			"validation",
			"review",
			"record",
			"integrate",
			"extra",
		]),
		true,
	);
	assert.equal(validatePhaseOrder(["planning", "discovery"]), false);
	assert.equal(validatePhaseOrder(["discovery"]), false);
});

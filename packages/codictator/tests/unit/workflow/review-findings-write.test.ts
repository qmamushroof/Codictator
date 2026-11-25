import { strict as assert } from "node:assert";

import test from "node:test";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import { checkWriteWithinPlan } from "../../../src/features/workflow/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function reviewTask(): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a thing",
		branch: "fix/thing",
		phase: "review",
		phases: [
			{ name: "discovery", enteredAt: FIXED_INSTANT, evidence: "spec refs" },
		],
		spec: ["§4.12"],
		acceptanceCriteria: ["fixed"],
		files: { allow: ["src/**"] },
	};
}

test("[§4.12.4] review phase allows only this task's findings file write", async () => {
	// SPEC §4.12.3 L1 + EC-4: the fresh reviewer writes the round's findings
	// file, and nothing else, while the task is in review.
	for (const round of ["1", "2", "12"]) {
		const findings = await checkWriteWithinPlan(
			reviewTask(),
			[`.codictator/reviews/T-0001-r${round}.json`],
			"review",
			{ changeClass: "code" },
		);
		assert.deepEqual(findings, []);
	}
});

test("[§4.12.4] review phase still blocks other paths and wrong-task or malformed findings paths", async () => {
	// SPEC §4.12.3 L1 + EC-4: every other write in review stays blocked.
	const blocked = [
		"src/a.ts",
		".codictator/tasks/T-0001.json",
		".codictator/reviews/T-0002-r1.json",
		".codictator/reviews/T-0001-r0.json",
		".codictator/reviews/T-0001-r01.json",
		".codictator/reviews/T-0001-r1x.json",
		".codictator/reviews/T-0001-r1.txt",
		".codictator/reviews/T-0001.json",
		".codictator/reviews/sub/T-0001-r1.json",
		"other/.codictator/reviews/T-0001-r1.json",
	];
	for (const path of blocked) {
		const findings = await checkWriteWithinPlan(
			reviewTask(),
			[path],
			"review",
			{ changeClass: "code" },
		);
		assert.ok(
			findings.some((finding) => finding.ruleId === "core/writes-within-plan"),
			`${path} should be blocked in review`,
		);
	}
	// Under the default classification `.codictator/**` is manifest-owned and
	// judged by core/no-bypass, so another task's findings file is the one
	// shape the plan gate itself must still refuse.
	const wrongTask = await checkWriteWithinPlan(
		reviewTask(),
		[".codictator/reviews/T-0002-r1.json"],
		"review",
	);
	assert.equal(wrongTask.length, 1);
	assert.equal(wrongTask[0]?.ruleId, "core/writes-within-plan");
	// The findings path is allowed only in review; implementation judges it
	// against files.allow like any other path.
	const elsewhere = await checkWriteWithinPlan(
		{ ...reviewTask(), phase: "implementation" },
		[".codictator/reviews/T-0001-r1.json"],
		"implementation",
		{ changeClass: "code" },
	);
	assert.equal(elsewhere.length, 1);
});

import { strict as assert } from "node:assert";

import test from "node:test";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import { checkPhaseGate } from "../../../src/features/workflow/index.ts";

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

test("[§4.12.2] a docs task whose files.allow touches code files is reclassified as code and owes the proofs", async () => {
	const mixed = {
		type: "docs",
		files: { allow: ["docs/**", "src/**"] },
	} as const;
	const planning = await checkPhaseGate(
		taskFor({ ...mixed, phase: "planning" }),
		"implementation",
	);
	assert.ok(
		planning.some(
			(finding) =>
				finding.code === "CDX-E604" &&
				finding.message.includes("declared tests") &&
				finding.message.includes("red proof"),
		),
	);
	const validation = await checkPhaseGate(
		taskFor({ ...mixed, phase: "validation" }),
		"review",
	);
	assert.ok(
		validation.some(
			(finding) =>
				finding.code === "CDX-E604" && finding.message.includes("green proof"),
		),
	);
	const docsOnly = await checkPhaseGate(
		taskFor({
			type: "docs",
			phase: "validation",
			files: {
				allow: ["docs/**", "README.md", ".codictator/tasks/T-0001.json"],
			},
		}),
		"review",
	);
	assert.deepEqual(docsOnly, []);
});

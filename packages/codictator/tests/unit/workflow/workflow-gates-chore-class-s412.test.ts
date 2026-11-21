import { strict as assert } from "node:assert";

import test from "node:test";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import { checkPhaseGate } from "../../../src/features/workflow/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function taskFor(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "chore",
		title: "regen the harness",
		branch: "chore/regen",
		phase: "discovery",
		phases: [
			{ name: "discovery", enteredAt: FIXED_INSTANT, evidence: "spec refs" },
		],
		spec: [],
		acceptanceCriteria: [],
		files: { allow: ["package.json", ".githooks/**", ".codictator/tasks/*"] },
		...over,
	};
}

test("[§4.12.2] a chore limited to manifest-owned files owes nothing before the record phase (BUG-0114)", async () => {
	for (const phase of [
		"discovery",
		"planning",
		"implementation",
		"validation",
		"review",
	] as const) {
		const findings = await checkPhaseGate(
			taskFor({ phase }),
			"next-phase-placeholder",
		);
		assert.ok(
			findings.every((finding) => finding.code !== "CDX-E604"),
			`${phase} owed evidence: ${JSON.stringify(findings)}`,
		);
	}
});

test("[§4.12.2] a chore still owes the record evidence (BUG-0114)", async () => {
	const findings = await checkPhaseGate(
		taskFor({ phase: "record" }),
		"integrate",
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.code === "CDX-E604" &&
				finding.message.includes("staged history entry"),
		),
	);
});

test("[§4.12.2] a chore whose files.allow touches code files owes every gate (BUG-0114)", async () => {
	const findings = await checkPhaseGate(
		taskFor({
			phase: "planning",
			files: { allow: ["package.json", "src/**"] },
		}),
		"implementation",
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.code === "CDX-E604" &&
				finding.message.includes("declared tests") &&
				finding.message.includes("red proof"),
		),
	);
});

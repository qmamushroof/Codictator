// SPEC §5.9 real-scope judging for workflow/review: gate, plan and round
// caps over the claiming task records. Missing exit evidence blocks the
// advance; completed plans never judge their own landing commit.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding } from "../../../src/features/engine/index.ts";
import { bindRule } from "../../../src/features/packs/enforcers/binding.ts";
import {
	nextPhaseOf,
	reviewGateReal,
	reviewRoundCapReal,
	workflowGatesReal,
	writesWithinPlanReal,
} from "../../../src/features/packs/enforcers/workflow-real.ts";
import type { PackRule, Ports } from "../../../src/kernel/index.ts";
import { activeTaskPorts } from "../../support/active-task-ports.ts";

function ruleFor(id: string): PackRule {
	return {
		id,
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "test-enforcer",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function taskJson(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		version: 1,
		id: "T-0001",
		type: "feature",
		title: "add a thing",
		branch: "feature/x",
		phase: "implementation",
		phases: [],
		spec: ["docs/SPEC/10-TESTING-STRATEGY.md"],
		acceptanceCriteria: ["works"],
		files: { allow: ["src/**"] },
		...over,
	});
}

function portsWith(task: string): Ports {
	return activeTaskPorts(task);
}

function reviewRound(round: number): Record<string, unknown> {
	return {
		round,
		tree: "tree0",
		reviewerSession: "session-1",
		identity: "observed",
		openBlockers: 0,
		openMajors: 0,
		acknowledgedExceptions: [],
		at: "2026-01-01T00:00:00.000Z",
	};
}

test("[§5.9] next phase advances the mandatory order only", () => {
	assert.equal(nextPhaseOf("planning"), "implementation");
	assert.equal(nextPhaseOf("integrate"), undefined);
	assert.equal(nextPhaseOf("bogus"), undefined);
});

test("[§5.9] real scope flags a task missing its exit evidence", async () => {
	const findings = await workflowGatesReal(
		portsWith(taskJson({ phase: "validation" })),
		["src/a.ts"],
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/workflow-gates"),
	);
});

test("[§5.9] real scope stays quiet at the final phase", async () => {
	const findings = await workflowGatesReal(
		portsWith(taskJson({ phase: "integrate" })),
		["src/a.ts"],
	);
	assert.deepEqual(findings, []);
});

test("[§5.9] real scope flags writes outside the plan", async () => {
	const findings = await writesWithinPlanReal(
		portsWith(taskJson({ files: { allow: ["src/kept.ts"] } })),
		["src/kept.ts", "src/other.ts"],
		false,
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/writes-within-plan");
	assert.equal(findings[0]?.path, "src/other.ts");
});

test("[§5.9] real scope stays quiet for the staged record landing", async () => {
	const findings = await writesWithinPlanReal(
		portsWith(
			taskJson({
				phase: "record",
				historyStaged: true,
				files: { allow: ["src/**", "docs/HISTORY/**"] },
			}),
		),
		["src/kept.ts", "docs/HISTORY/2026-10-05.md"],
		false,
	);
	assert.deepEqual(findings, []);
});

test("[§5.9] real scope flags a review without a completed round", async () => {
	const findings = await reviewGateReal(
		portsWith(taskJson({ phase: "review" })),
		["src/a.ts"],
	);
	assert.ok(findings.some((finding) => finding.ruleId === "core/review-gate"));
});

test("[§5.9] real scope flags review rounds past the cap", async () => {
	const ports = portsWith(
		taskJson({ reviews: [reviewRound(1), reviewRound(2)] }),
	);
	const findings: Array<Finding> = [];
	await reviewRoundCapReal(
		ports,
		bindRule(ruleFor("core/review-round-cap")),
		["src/a.ts"],
		findings,
		1,
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/review-round-cap");
});

test("[§5.9] real scope stays quiet within the round cap", async () => {
	const ports = portsWith(taskJson({ reviews: [reviewRound(1)] }));
	const findings: Array<Finding> = [];
	await reviewRoundCapReal(
		ports,
		bindRule(ruleFor("core/review-round-cap")),
		["src/a.ts"],
		findings,
		5,
	);
	assert.deepEqual(findings, []);
});

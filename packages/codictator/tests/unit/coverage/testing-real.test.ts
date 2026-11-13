// SPEC §5.4 real-scope judging for testing: red-proof, test-kind and
// regression checks over the task records that claim the scope. A config
// change widens the required kinds to architecture; fixes owe regression.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	redBeforeGreenReal,
	regressionTestReal,
	testKindsReal,
} from "../../../src/features/packs/enforcers/testing-real.ts";
import type { Ports } from "../../../src/kernel/index.ts";
import { activeTaskPorts } from "../../support/active-task-ports.ts";

function taskJson(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a defect",
		branch: "fix/x",
		phase: "implementation",
		phases: [],
		spec: [],
		acceptanceCriteria: ["fixed"],
		files: { allow: ["src/**", ".codictator/**"] },
		...over,
	});
}

function portsWith(task: string): Ports {
	return activeTaskPorts(task);
}

test("[§5.4] real scope flags a fix without a red proof", async () => {
	const findings = await redBeforeGreenReal(
		portsWith(taskJson({ tests: [] })),
		["src/a.ts"],
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/red-before-green"),
	);
});

test("[§5.4] real scope stays quiet once the red proof lands", async () => {
	const findings = await redBeforeGreenReal(
		portsWith(
			taskJson({
				tests: [{ path: "tests/a.test.ts", title: "fails red", kind: "unit" }],
				redProof: {
					commit: "abc",
					tree: "tree0",
					failing: ["fails red"],
					at: "2026-01-01T00:00:00.000Z",
				},
			}),
		),
		["src/a.ts"],
	);
	assert.deepEqual(findings, []);
});

test("[§5.4] real scope stays quiet before implementation begins", async () => {
	const findings = await redBeforeGreenReal(
		portsWith(taskJson({ phase: "planning", tests: [] })),
		["src/a.ts"],
	);
	assert.deepEqual(findings, []);
});

test("[§5.4] real scope requires architecture tests on config changes", async () => {
	const findings = await testKindsReal(
		portsWith(
			taskJson({
				type: "feature",
				tests: [{ path: "tests/a.test.ts", title: "unit", kind: "unit" }],
			}),
		),
		["src/a.ts", ".codictator/config.json"],
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.ruleId === "core/test-kinds-by-scenario" &&
				finding.message.includes("architecture"),
		),
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.ruleId === "core/test-kinds-by-scenario" &&
				finding.message.includes("acceptance"),
		),
	);
});

test("[§5.4] real scope stays quiet for non-code tasks", async () => {
	const findings = await testKindsReal(portsWith(taskJson({ type: "docs" })), [
		"src/a.ts",
	]);
	assert.deepEqual(findings, []);
});

test("[§5.4] real scope flags a fix without a regression test", async () => {
	const findings = await regressionTestReal(
		portsWith(
			taskJson({
				tests: [{ path: "tests/a.test.ts", title: "t", kind: "unit" }],
			}),
		),
		["src/a.ts"],
	);
	assert.ok(
		findings.some(
			(finding) => finding.ruleId === "core/regression-test-for-fix",
		),
	);
});

test("[§5.4] real scope stays quiet once the regression test lands", async () => {
	const findings = await regressionTestReal(
		portsWith(
			taskJson({
				tests: [{ path: "tests/r.test.ts", title: "t", kind: "regression" }],
			}),
		),
		["src/a.ts"],
	);
	assert.deepEqual(findings, []);
});

test("[§5.4] Codictator task and review records are not code for test kinds", async () => {
	const findings = await testKindsReal(
		portsWith(taskJson({ type: "feature" })),
		[
			".codictator/tasks/T-0001.json",
			".codictator/reviews/T-0001-r1.json",
			"docs/BUGS/2026.md",
		],
	);
	assert.deepEqual(findings, []);
});

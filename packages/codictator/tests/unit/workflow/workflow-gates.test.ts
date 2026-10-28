// SPEC §4.12.1–§4.12.6: task-record helpers, L1 write gating, phase order
// and the review-cap escalation path. Pure data helpers plus findings; the
// hook runtime supplies the context, so no OS is touched here.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import {
	checkLoop,
	checkPhaseGate,
	checkReview,
	checkReviewCap,
	checkWriteWithinPlan,
	classifyChange,
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

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: ["src/a.ts"], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
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

test("[§4.12] workflow writes classify deps docs and code", () => {
	assert.equal(classifyChange([]), "code");
	assert.equal(classifyChange(["package.json", "package-lock.json"]), "chore");
	assert.equal(classifyChange(["docs/a.md"]), "docs");
	assert.equal(classifyChange(["docs/a.md", "src/a.ts"]), "code");
});

test("[§4.12] workflow write gate blocks taskless and out-of-plan writes", async () => {
	const taskless = await checkWriteWithinPlan(
		undefined,
		["src/a.ts"],
		"implementation",
	);
	assert.ok(
		taskless.some((finding) => finding.ruleId === "core/workflow-gates"),
	);
	const deps = await checkWriteWithinPlan(
		undefined,
		["package.json"],
		"implementation",
		{ changeClass: "deps" },
	);
	assert.deepEqual(deps, []);
	const bot = await checkWriteWithinPlan(undefined, ["docs/a.md"], "planning", {
		bot: true,
	});
	assert.deepEqual(bot, []);
	const chore = await checkWriteWithinPlan(
		taskFor(),
		["package.json"],
		"review",
		{ changeClass: "chore" },
	);
	assert.deepEqual(chore, []);
	const outside = await checkWriteWithinPlan(
		taskFor({ files: { allow: ["src/kept/**"] } }),
		["src/other/x.ts"],
		"implementation",
	);
	assert.ok(
		outside.some((finding) => finding.ruleId === "core/writes-within-plan"),
	);
	const reviewBlock = await checkWriteWithinPlan(
		taskFor(),
		["src/new.ts"],
		"review",
	);
	assert.ok(reviewBlock[0]?.remediation.includes("voids proofs"));
	const allowed = await checkWriteWithinPlan(
		taskFor(),
		["docs/note.md"],
		"review",
	);
	assert.deepEqual(allowed, []);
});

test("[§4.12] workflow write gate judges every phase class", async () => {
	const task = taskFor({ phase: "discovery" });
	assert.deepEqual(
		await checkWriteWithinPlan(task, ["src/t.test.ts"], "discovery"),
		[],
	);
	assert.equal(
		(await checkWriteWithinPlan(task, ["src/a.ts"], "planning")).length,
		1,
	);
	assert.equal(
		(
			await checkWriteWithinPlan(
				taskFor({ phase: "record" }),
				["docs/HISTORY/2026-10.md"],
				"record",
			)
		).length,
		0,
	);
	assert.equal(
		(
			await checkWriteWithinPlan(
				taskFor({ phase: "record" }),
				["src/a.ts"],
				"record",
			)
		).length,
		1,
	);
	assert.equal(
		(
			await checkWriteWithinPlan(
				taskFor({ phase: "integrate" }),
				["src/a.ts"],
				"integrate",
			)
		).length,
		1,
	);
});

test("[§4.12] workflow review records malformed stale and capped rounds", async () => {
	const ctx = ctxFor();
	const malformed = await checkReview(ctx, {
		version: 1,
		findings: [{ id: "", severity: "blocker", path: "x", message: "" }],
	});
	assert.ok(malformed.some((finding) => finding.code === "CDX-E607"));
	const dup = await checkReview(ctx, {
		version: 1,
		tree: "t",
		reviewerSession: "fresh",
		findings: [
			{ id: "F-1", severity: "minor", path: "a", message: "m1" },
			{ id: "F-1", severity: "nit", path: "b", message: "m2" },
		],
	});
	assert.ok(dup.some((finding) => finding.code === "CDX-E607"));
	const badSeverity = await checkReview(ctx, {
		version: 1,
		findings: [{ id: "F-1", severity: "huge", path: "a", message: "m" }],
	});
	assert.ok(badSeverity.some((finding) => finding.code === "CDX-E607"));
	const unbound = await checkReview(ctx, { version: 1, findings: [] });
	assert.ok(unbound.some((finding) => finding.code === "CDX-E607"));
	assert.ok(unbound.some((finding) => finding.code === "CDX-E605"));
	const stale = await checkReview(
		ctx,
		{ version: 1, tree: "old", reviewerSession: "fresh", findings: [] },
		{ tree: "new" },
	);
	assert.ok(stale.some((finding) => finding.message.includes("stale review")));
	const capped = await checkReview(
		ctx,
		{ version: 1, tree: "t", reviewerSession: "fresh", findings: [] },
		{ maxRounds: 2, completedRounds: 2 },
	);
	assert.ok(
		capped.some((finding) => finding.ruleId === "core/review-round-cap"),
	);
	const blockers = await checkReview(ctx, {
		version: 1,
		tree: "t",
		reviewerSession: "fresh",
		findings: [
			{
				id: "F-9",
				severity: "major",
				path: "src/x.ts",
				line: 3,
				message: "broken",
			},
		],
	});
	assert.ok(blockers.some((finding) => finding.path === "src/x.ts"));
	assert.deepEqual(
		await checkReview(ctx, {
			version: 1,
			tree: "t",
			reviewerSession: "fresh",
			findings: [],
		}),
		[],
	);
});

test("[§4.12] workflow loop cap escalates past the max", async () => {
	assert.deepEqual(await checkReviewCap(1, 3), []);
	const escalated = await checkReviewCap(3, 3);
	assert.ok(
		escalated.some((finding) => finding.ruleId === "core/review-round-cap"),
	);
	assert.deepEqual(await checkLoop(ctxFor(), 3), []);
	const looped = await checkLoop(ctxFor(), 4);
	assert.ok(looped.some((finding) => finding.ruleId === "core/loop-breaker"));
});

test("[§4.12] workflow phase gates demand exit evidence", async () => {
	const fixNoDiagnosis = await checkPhaseGate(
		taskFor({ type: "fix", phase: "discovery" }),
		"planning",
	);
	assert.ok(fixNoDiagnosis.some((finding) => finding.code === "CDX-E604"));
	const noAllow = await checkPhaseGate(
		taskFor({ phase: "planning", files: { allow: [] } }),
		"implementation",
	);
	assert.ok(noAllow.some((finding) => finding.code === "CDX-E604"));
	const validation = await checkPhaseGate(
		taskFor({ phase: "validation" }),
		"review",
	);
	assert.ok(validation.some((finding) => finding.code === "CDX-E604"));
	const record = await checkPhaseGate(
		taskFor({ phase: "record" }),
		"integrate",
	);
	assert.ok(record.some((finding) => finding.code === "CDX-E604"));
	const good = await checkPhaseGate(
		taskFor({ phase: "implementation" }),
		"implementation",
	);
	assert.deepEqual(good, []);
});

// SPEC §4.12: phases, tasks, review, loop breaker. Owns the §7.11 task
// record and the §7.16 review findings formats. The three check entry
// points below are the contracts the §4.12 EC tests assert.
import type { CheckContext, Finding } from "../engine/index.ts";
import { checkLoop as checkLoopImpl, DEFAULT_MAX_REPEATS } from "./loop.ts";
import {
	checkPhaseGate as checkPhaseGateImpl,
	type PhaseGateDetail,
} from "./phases.ts";
import {
	checkReview as checkReviewImpl,
	type ReviewCheckDetail,
	type ReviewFindingsFile,
} from "./review.ts";
import type { TaskRecord } from "./tasks.ts";

export {
	checkReviewCap,
	DEFAULT_MAX_REPEATS,
	escalationMessage,
} from "./loop.ts";
export {
	isMandatoryPhase,
	MANDATORY_PHASES,
	validatePhaseOrder,
} from "./phases.ts";
export type { ReviewFinding, ReviewSeverity } from "./review.ts";
export type {
	AgentRole,
	ChangeClass,
	ReviewRound,
	TaskEscalation,
	TaskGreenProof,
	TaskPhase,
	TaskProof,
	TaskRecord,
	TaskTestRef,
	TaskType,
} from "./tasks.ts";
export {
	isTaskId,
	mergeTaskRecords,
	resolveActiveTask,
	roleForAsset,
	TASK_LOCK_PATH,
	taskIdFor,
	validateTaskRecord,
} from "./tasks.ts";
export {
	checkWriteWithinPlan,
	classifyChange,
	type WriteCheckOptions,
} from "./writes.ts";
export type { PhaseGateDetail, ReviewCheckDetail, ReviewFindingsFile };

// SPEC §4.12.2: phase gate evaluation for the task state machine.
export function checkPhaseGate(
	task: TaskRecord,
	phase: string,
	detail?: PhaseGateDetail,
): Promise<Array<Finding>> {
	return checkPhaseGateImpl(task, phase, detail ?? {});
}

// SPEC §4.12.4: review gate verdicts.
export function checkReview(
	ctx: CheckContext,
	findings: ReviewFindingsFile,
	detail?: ReviewCheckDetail,
): Promise<Array<Finding>> {
	return checkReviewImpl(ctx, findings, detail ?? {});
}

// SPEC §4.12.5: loop breaker escalation.
export function checkLoop(
	ctx: CheckContext,
	attempts: number,
	maxRepeats?: number,
): Promise<Array<Finding>> {
	return checkLoopImpl(ctx, attempts, maxRepeats ?? DEFAULT_MAX_REPEATS);
}

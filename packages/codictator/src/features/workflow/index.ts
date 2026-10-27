// SPEC §4.12: phases, tasks, review, loop breaker. Owns the §7.11 task
// record and the §7.16 review findings formats.
import type { CheckContext, Finding } from "../engine/index.ts";

export interface TaskPhase {
	readonly name: string;
	readonly enteredAt: string;
	readonly evidence: string;
}

export interface TaskRecord {
	readonly version: 1;
	readonly id: string;
	readonly type: string;
	readonly title: string;
	readonly branch: string;
	readonly phase: string;
	readonly phases: ReadonlyArray<TaskPhase>;
	readonly spec: ReadonlyArray<string>;
	readonly acceptanceCriteria: ReadonlyArray<string>;
	readonly files: { readonly allow: ReadonlyArray<string> };
}

export interface ReviewFinding {
	readonly id: string;
	readonly severity: string;
	readonly path: string;
	readonly line?: number;
	readonly message: string;
}

export interface ReviewFindingsFile {
	readonly version: 1;
	readonly findings: ReadonlyArray<ReviewFinding>;
}

// SPEC §4.12.2: phase gate evaluation for the task state machine.
export function checkPhaseGate(
	_task: TaskRecord,
	_phase: string,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.12.2");
}

// SPEC §4.12.4: review gate verdicts.
export function checkReview(
	_ctx: CheckContext,
	_findings: ReviewFindingsFile,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.12.4");
}

// SPEC §4.12.5: loop breaker escalation.
export function checkLoop(
	_ctx: CheckContext,
	_attempts: number,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.12.5");
}

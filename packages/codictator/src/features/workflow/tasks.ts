// SPEC §4.12.1 + §7.11: task records, ids, branch binding, lock and roles.
// Pure data helpers over the task record; the phase machine lives in
// phases.ts, the review gate in review.ts and the loop breaker in loop.ts.
export type TaskType =
	| "feature"
	| "fix"
	| "refactor"
	| "docs"
	| "deps"
	| "chore";

export type ChangeClass =
	| "code"
	| "docs"
	| "refactor"
	| "deps"
	| "chore"
	| "guardrail";

export type AgentRole = "planner" | "implementer" | "reviewer" | "qa";

export interface TaskPhase {
	readonly name: string;
	readonly enteredAt: string;
	readonly evidence: string;
}

export interface TaskTestRef {
	readonly path: string;
	readonly title: string;
	readonly kind: string;
}

export interface TaskProof {
	readonly commit: string;
	readonly tree: string;
	readonly failing: ReadonlyArray<string>;
	readonly at: string;
}

export interface TaskGreenProof {
	readonly at: string;
	readonly tree: string;
}

export interface ReviewRound {
	readonly round: number;
	readonly tree: string;
	readonly reviewerSession: string;
	readonly identity: "observed" | "declared";
	readonly openBlockers: number;
	readonly openMajors: number;
	readonly acknowledgedExceptions: ReadonlyArray<string>;
	readonly at: string;
}

export interface TaskEscalation {
	readonly at: string;
	readonly ruleId: string;
	readonly attempts: number;
	readonly ackedBy?: string;
	readonly note?: string;
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
	readonly customPhases?: ReadonlyArray<string>;
	readonly tests?: ReadonlyArray<TaskTestRef>;
	readonly diagnosis?: string;
	readonly redProof?: TaskProof;
	readonly greenProof?: TaskGreenProof;
	readonly authorSessions?: ReadonlyArray<string>;
	readonly roles?: Readonly<Record<string, AgentRole>>;
	readonly reviews?: ReadonlyArray<ReviewRound>;
	readonly integrityExceptions?: ReadonlyArray<string>;
	readonly historyStaged?: boolean;
	readonly bugRowUpdated?: boolean;
	readonly escalations?: ReadonlyArray<TaskEscalation>;
}

// SPEC §4.12.1: ids are T-####, sequential per repo.
const TASK_ID_PATTERN = /^T-\d{4}$/;

export function isTaskId(value: string): boolean {
	return TASK_ID_PATTERN.test(value);
}

export function taskIdFor(sequence: number): string {
	return `T-${String(sequence).padStart(4, "0")}`;
}

// SPEC §4.12.1: a branch has at most one open task, which is the active
// task for every hook on that branch, subagents included.
export function resolveActiveTask(
	tasks: ReadonlyArray<TaskRecord>,
	branch: string,
): TaskRecord | undefined {
	for (const task of tasks) {
		if (task.branch === branch) {
			return task;
		}
	}
	return undefined;
}

// SPEC §4.12.6: one lock serialises task-record writes on a machine.
export const TASK_LOCK_PATH = ".codictator/state/task.lock";

// SPEC §4.12.6: roles are recorded per session from the subagent or skill
// name. The codictator-review asset marks reviewers; gates are the same
// for every role, so the label only informs injection.
const ROLE_ASSETS: ReadonlyArray<readonly [string, AgentRole]> = [
	["codictator-review", "reviewer"],
	["review", "reviewer"],
	["qa", "qa"],
	["implement", "implementer"],
	["plan", "planner"],
];

export function roleForAsset(asset: string): AgentRole | undefined {
	const lowered = asset.toLowerCase();
	for (const [fragment, role] of ROLE_ASSETS) {
		if (lowered.includes(fragment)) {
			return role;
		}
	}
	return undefined;
}

// SPEC §4.12.6: on merge conflicts in a task record the later phase wins
// only if its gate evidence verifies. Entry in phases[] is the evidence
// of entry; per-gate evidence is verified by the caller through evidenceOk.
export function mergeTaskRecords(
	base: TaskRecord,
	head: TaskRecord,
	phaseOrder: ReadonlyArray<string>,
	evidenceOk?: (phase: string) => boolean,
): TaskRecord {
	const baseIndex = phaseOrder.indexOf(base.phase);
	const headIndex = phaseOrder.indexOf(head.phase);
	const headLater = headIndex > baseIndex;
	const verified =
		evidenceOk === undefined
			? head.phases.some((entry) => entry.name === head.phase)
			: evidenceOk(head.phase);
	if (headLater && verified) {
		return head;
	}
	return base;
}

// SPEC §4.12.1 + §4.12.2: the record is only writable through task commands;
// direct writes are blocked (§4.14.3). Structural validation for new tasks.
export function validateTaskRecord(task: TaskRecord): Array<string> {
	const problems: Array<string> = [];
	if (!isTaskId(task.id)) {
		problems.push(`id "${task.id}" is not T-####`);
	}
	const types: ReadonlyArray<string> = [
		"feature",
		"fix",
		"refactor",
		"docs",
		"deps",
		"chore",
	];
	if (!types.includes(task.type)) {
		problems.push(`type "${task.type}" is not a task type`);
	}
	if (task.branch.length === 0) {
		problems.push("branch is empty; a task binds to its branch");
	}
	if (task.title.length === 0) {
		problems.push("title is empty");
	}
	return problems;
}

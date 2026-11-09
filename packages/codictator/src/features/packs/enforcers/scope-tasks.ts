// Shared task-scope reads for the code enforcers (SPEC §4.3.2, §4.12.3).
// The fixture-marker path (sample.txt self-test reports) never touches
// disk beyond the scope files; the real-scope path reads the committed
// task records under .codictator/tasks, which the CLI owns (§4.12.1).
// No task records on disk (unit fakes, repos without tasks) means nothing
// to judge, so the real path stays quiet instead of false-blocking.
import { globMatch, type Ports } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import {
	readBranchAt,
	readTaskRecords,
	resolveActiveTask,
	type TaskRecord,
} from "../../workflow/index.ts";

// The on-disk task records, id-sorted for deterministic verdicts (§4.3.6).
// Unreadable or malformed records are skipped, never fatal: the hook and CI
// paths judge tasklessness with branch context, while enforcers judge the
// records they can read. The reader is shared with steering and the CLI.
export async function readScopeTasks(ports: Ports): Promise<Array<TaskRecord>> {
	return readTaskRecords(ports);
}

// The tasks claiming the scope: any files.allow glob matching any scope
// file. The gate judges the change against the plan that claims it, so an
// unrelated scope never inherits another task's missing evidence.
export function tasksForScope(
	tasks: ReadonlyArray<TaskRecord>,
	files: ReadonlyArray<string>,
): Array<TaskRecord> {
	return tasks.filter((task) =>
		(task.files?.allow ?? []).some((glob) =>
			files.some((file) => globMatch(glob, file)),
		),
	);
}

// Shared real-scope read: the committed task records claiming the scope.
// One call site per enforcer keeps the split real files free of the
// repeated read-then-filter token run.
export async function readTasksForScope(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<TaskRecord>> {
	return tasksForScope(await readScopeTasks(ports), files);
}

// Shared task-loop verdict: read the claiming records once and judge each
// in id order, collecting findings. One loop site for every real-scope
// helper, so the split real modules share no duplicated task-loop run
// (core/duplication counts exact token runs across scope files).
export async function collectTaskFindings(
	ports: Ports,
	files: ReadonlyArray<string>,
	judge: (task: TaskRecord, findings: Array<Finding>) => void | Promise<void>,
): Promise<Array<Finding>> {
	const tasks = await readTasksForScope(ports, files);
	const findings: Array<Finding> = [];
	for (const task of tasks) {
		await judge(task, findings);
	}
	return findings;
}

// SPEC §4.12.1: the branch task is the active task for every hook on that
// branch. The lookup rides the existing git and proc ports, mirroring the
// CLI branchOf path; an unreadable branch (no root, failed or empty branch
// read) answers undefined, so the caller judges with no active task instead
// of judging blind.
export async function readBranch(ports: Ports): Promise<string | undefined> {
	const root = await ports.git.root();
	if (!root.ok) {
		return undefined;
	}
	return readBranchAt(ports, root.value);
}

// SPEC §4.12.1: the active task for the branch, reusing the branch-binding
// lookup from tasks.ts. An unreadable branch means no active task.
export async function activeTaskFor(
	ports: Ports,
	branch: string | undefined,
): Promise<TaskRecord | undefined> {
	if (branch === undefined) {
		return undefined;
	}
	return resolveActiveTask(await readScopeTasks(ports), branch);
}

// The judged set: the active task for the branch plus every task claiming
// the scope, id-sorted for deterministic verdicts (§4.3.6). Judging the
// active task — not only claiming tasks — closes the silent-allow gap: with
// no active task the caller's EC-1 path fires instead of nothing.
export async function readJudgedTasks(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<TaskRecord>> {
	const active = await activeTaskFor(ports, await readBranch(ports));
	const tasks = await readTasksForScope(ports, files);
	if (active !== undefined && !tasks.some((task) => task.id === active.id)) {
		tasks.push(active);
	}
	return tasks.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// Shared active-task loop: one call site per judging helper, so the split
// real modules share no repeated loop run.
export async function collectActiveTaskFindings(
	ports: Ports,
	files: ReadonlyArray<string>,
	judge: (task: TaskRecord, findings: Array<Finding>) => void | Promise<void>,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const task of await readJudgedTasks(ports, files)) {
		await judge(task, findings);
	}
	return findings;
}

// Code classes owe the TDD proofs; docs, refactor, deps and chore follow
// their change-class paths instead (§4.12.2).
export function isCodeTask(task: TaskRecord): boolean {
	return task.type === "feature" || task.type === "fix";
}

const POST_PLANNING: ReadonlySet<string> = new Set([
	"implementation",
	"validation",
	"review",
	"record",
	"integrate",
]);

// Implementation began: the task left planning for a later phase.
export function implementationBegan(task: TaskRecord): boolean {
	return POST_PLANNING.has(task.phase);
}

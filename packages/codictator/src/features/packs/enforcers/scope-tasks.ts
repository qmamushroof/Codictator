// Shared task-scope reads for the code enforcers (SPEC §4.3.2, §4.12.3).
// The fixture-marker path (sample.txt self-test reports) never touches
// disk beyond the scope files; the real-scope path reads the committed
// task records under .codictator/tasks, which the CLI owns (§4.12.1).
// No task records on disk (unit fakes, repos without tasks) means nothing
// to judge, so the real path stays quiet instead of false-blocking.
import type { Ports } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import {
	readBranchAt,
	readTaskRecords,
	resolveActiveTask,
	TASKS_DIR,
	type TaskRecord,
} from "../../workflow/index.ts";

// The on-disk task records, id-sorted for deterministic verdicts (§4.3.6).
// Unreadable or malformed records are skipped, never fatal: the hook and CI
// paths judge tasklessness with branch context, while enforcers judge the
// records they can read. The reader is shared with steering and the CLI.
export async function readScopeTasks(ports: Ports): Promise<Array<TaskRecord>> {
	return readTaskRecords(ports);
}

// SPEC §4.12.3: a task is touched when its record is in the judged scope
// (the staged set or the PR range adds or changes it). A files.allow glob
// that merely matches a scope file is not ownership of the change, so a
// finished or parallel task never inherits another task's verdict.
export function touchedTasks(
	tasks: ReadonlyArray<TaskRecord>,
	files: ReadonlyArray<string>,
): Array<TaskRecord> {
	return tasks.filter((task) => files.includes(`${TASKS_DIR}/${task.id}.json`));
}

// Shared task-loop verdict over the judged set, in id order. One loop site
// for every real-scope helper, so the split real modules share no
// duplicated task-loop run (core/duplication counts exact token runs).
export async function collectTaskFindings(
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

// The judged set (SPEC §4.12.1, §4.12.3): the active task for the branch
// plus every task whose record the scope touches, id-sorted for
// deterministic verdicts (§4.3.6). With neither, the caller's EC-1 path
// fires on a live write and gate legs stay quiet.
export async function readJudgedTasks(
	ports: Ports,
	files: ReadonlyArray<string>,
): Promise<Array<TaskRecord>> {
	const records = await readScopeTasks(ports);
	const branch = await readBranch(ports);
	const active =
		branch === undefined ? undefined : resolveActiveTask(records, branch);
	const tasks = touchedTasks(records, files);
	if (active !== undefined && !tasks.some((task) => task.id === active.id)) {
		tasks.push(active);
	}
	return tasks.sort((a, b) => (a.id < b.id ? -1 : 1));
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

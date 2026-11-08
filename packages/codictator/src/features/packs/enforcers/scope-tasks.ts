// Shared task-scope reads for the code enforcers (SPEC §4.3.2, §4.12.3).
// The fixture-marker path (sample.txt self-test reports) never touches
// disk beyond the scope files; the real-scope path reads the committed
// task records under .codictator/tasks, which the CLI owns (§4.12.1).
// No task records on disk (unit fakes, repos without tasks) means nothing
// to judge, so the real path stays quiet instead of false-blocking.
import { globMatch, type Ports, parseJson } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import type { TaskRecord } from "../../workflow/index.ts";

export const TASKS_DIR = ".codictator/tasks";

function taskRecordOf(text: string): TaskRecord | undefined {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return undefined;
	}
	if (typeof parsed.value !== "object" || parsed.value === null) {
		return undefined;
	}
	const record = parsed.value as TaskRecord;
	if (record.version !== 1 || typeof record.id !== "string") {
		return undefined;
	}
	return record;
}

// The on-disk task records, id-sorted for deterministic verdicts (§4.3.6).
// Unreadable or malformed records are skipped, never fatal: the hook and CI
// paths judge tasklessness with branch context, while enforcers judge the
// records they can read.
export async function readScopeTasks(ports: Ports): Promise<Array<TaskRecord>> {
	const listed = await ports.fs.list(TASKS_DIR);
	if (!listed.ok) {
		return [];
	}
	const out: Array<TaskRecord> = [];
	for (const name of listed.value) {
		const record = await readTaskRecord(ports, name);
		if (record !== undefined) {
			out.push(record);
		}
	}
	return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function readTaskRecord(
	ports: Ports,
	name: string,
): Promise<TaskRecord | undefined> {
	if (!name.endsWith(".json")) {
		return undefined;
	}
	const text = await ports.fs.readText(`${TASKS_DIR}/${name}`);
	if (!text.ok) {
		return undefined;
	}
	return taskRecordOf(text.value);
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

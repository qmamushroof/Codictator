// SPEC §4.12.1: the committed task records and the branch they bind to,
// read through the caller's ports. One reader serves the packs enforcers,
// the steering injection and the CLI git gates, so the active-task lookup
// cannot drift between layers (core/duplication counts the copies).
import { type Ports, parseJson } from "../../kernel/index.ts";
import type { TaskRecord } from "./tasks.ts";

// The task-record directory the CLI owns (§4.12.1).
export const TASKS_DIR = ".codictator/tasks";

// A record is a version-1 object with a string id; anything else is not a
// task record and is skipped, never fatal.
export function taskRecordOf(text: string): TaskRecord | undefined {
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

async function readTaskFile(
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

// The on-disk task records, id-sorted for deterministic verdicts (§4.3.6).
// An unlistable directory or unreadable record yields fewer records; the
// callers judge tasklessness with branch context.
export async function readTaskRecords(
	ports: Ports,
): Promise<Array<TaskRecord>> {
	const listed = await ports.fs.list(TASKS_DIR);
	if (!listed.ok) {
		return [];
	}
	const out: Array<TaskRecord> = [];
	for (const name of [...listed.value].sort()) {
		const record = await readTaskFile(ports, name);
		if (record !== undefined) {
			out.push(record);
		}
	}
	return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// SPEC §4.12.1: the branch a task binds to, read in `cwd`. A failed,
// timed-out, truncated or empty read answers undefined, so the caller
// judges with no active task instead of judging blind.
export async function readBranchAt(
	ports: Ports,
	cwd: string,
): Promise<string | undefined> {
	const ran = await ports.proc.run(["git", "branch", "--show-current"], {
		cwd,
		env: {},
		timeoutMs: 15_000,
		maxOutputBytes: 4096,
	});
	if (ran.timedOut || ran.truncated || ran.code !== 0) {
		return undefined;
	}
	const branch = ran.stdout.trim();
	return branch === "" ? undefined : branch;
}

// SPEC §4.12: task records. State lives in repo-relative JSON the workflow
// module validates; creation binds the branch, and listing surfaces every
// record through the same terse line.
import { parseArgs } from "node:util";
import {
	isTaskId,
	type TaskRecord,
	taskIdFor,
	validateTaskRecord,
} from "../features/workflow/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok, parseJson, stableStringify } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	portsFor,
	printHuman,
	printJson,
	usageError,
	writeStateText,
} from "./shared.ts";

export const TASKS_DIR = ".codictator/tasks";

export async function listTaskIds(root: string): Promise<Array<string>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return [];
	}
	const listed = await ports.value.fs.list(TASKS_DIR);
	if (!listed.ok) {
		return [];
	}
	return listed.value
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length))
		.filter((id) => isTaskId(id))
		.sort();
}

export async function readTask(
	root: string,
	id: string,
): Promise<TaskRecord | undefined> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return undefined;
	}
	const seen = await ports.value.fs.exists(`${TASKS_DIR}/${id}.json`);
	if (!seen.ok || !seen.value) {
		return undefined;
	}
	const text = await ports.value.fs.readText(`${TASKS_DIR}/${id}.json`);
	if (!text.ok) {
		return undefined;
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return undefined;
	}
	return parsed.value as TaskRecord;
}

export async function writeTask(
	root: string,
	task: TaskRecord,
): Promise<Result<number>> {
	const problems = validateTaskRecord(task);
	if (problems.length > 0) {
		return fail(
			"CDX-E604",
			`task record invalid: ${problems.join("; ")}`,
			"Fix the record fields, then retry.",
			false,
		);
	}
	const saved = await writeStateText(
		root,
		`${TASKS_DIR}/${task.id}.json`,
		`${stableStringify(task)}\n`,
	);
	if (!saved.ok) {
		return fail(
			"CDX-E903",
			saved.error.message,
			saved.error.remediation,
			false,
		);
	}
	return ok(0);
}

export function taskLine(task: TaskRecord): string {
	return `${task.id} [${task.type}] ${task.phase}: ${task.title}`;
}

export async function branchOf(root: string): Promise<string | undefined> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return undefined;
	}
	const result = await ports.value.proc.run(
		["git", "branch", "--show-current"],
		{
			cwd: root,
			env: {},
			timeoutMs: 15000,
			maxOutputBytes: 4096,
		},
	);
	const branch = result.stdout.trim();
	return result.code === 0 && branch !== "" ? branch : undefined;
}

export async function taskNew(
	req: CommandRequest,
	root: string,
): Promise<Result<number>> {
	let type = "";
	let title = "";
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: { type: { type: "string" }, title: { type: "string" } },
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator task new --type <t> --title <t>");
		}
		type = parsed.values.type ?? "";
		title = parsed.values.title ?? "";
	} catch {
		return usageError("usage: codictator task new --type <t> --title <t>");
	}
	if (type === "" || title === "") {
		return usageError("usage: codictator task new --type <t> --title <t>");
	}
	const branch = await branchOf(root);
	if (branch === undefined) {
		return fail(
			"CDX-E903",
			"cannot read the current branch",
			"Run on a git branch, then retry.",
			req.json,
		);
	}
	const ids = await listTaskIds(root);
	const task: TaskRecord = {
		version: 1,
		id: taskIdFor(ids.length + 1),
		type,
		title,
		branch,
		phase: "discovery",
		phases: [],
		spec: [],
		acceptanceCriteria: [],
		files: { allow: [] },
	};
	const saved = await writeTask(root, task);
	if (!saved.ok) {
		return saved;
	}
	if (req.json) {
		printJson({ id: task.id, phase: task.phase, branch });
	} else {
		printHuman(`created ${taskLine(task)}`, req.quiet);
	}
	return ok(0);
}

export async function taskCheckpoint(
	req: CommandRequest,
	root: string,
): Promise<Result<number>> {
	let id = "";
	let note = "";
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: {
				id: { type: "string" },
				note: { type: "string", default: "" },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError(
				"usage: codictator task checkpoint --id <T-####> [--note <t>]",
			);
		}
		id = parsed.values.id ?? "";
		note = parsed.values.note ?? "";
	} catch {
		return usageError(
			"usage: codictator task checkpoint --id <T-####> [--note <t>]",
		);
	}
	const task = await readTask(root, id);
	if (task === undefined) {
		return fail(
			"CDX-E903",
			`no task record for "${id}"`,
			"List tasks with codictator task show, then retry.",
			req.json,
		);
	}
	const ports = await portsFor(root);
	const now = ports.ok ? ports.value.clock.now() : "";
	const saved = await writeStateText(
		root,
		`.codictator/state/task-${id}.checkpoint.json`,
		`${stableStringify({ version: 1, id, at: now, phase: task.phase, branch: task.branch, note })}\n`,
	);
	if (!saved.ok) {
		return fail(
			"CDX-E903",
			saved.error.message,
			saved.error.remediation,
			req.json,
		);
	}
	if (req.json) {
		printJson({ id, checkpoint: true });
	} else {
		printHuman(`checkpoint recorded for ${id}`, req.quiet);
	}
	return ok(0);
}

export async function taskClose(
	req: CommandRequest,
	root: string,
	id: string,
): Promise<Result<number>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const bytes = await ports.value.fs.read(`${TASKS_DIR}/${id}.json`);
	if (!bytes.ok) {
		return fail(
			"CDX-E903",
			bytes.error.message,
			bytes.error.remediation,
			req.json,
		);
	}
	const moved = await ports.value.fs.write(
		`.codictator/state/closed-tasks/${id}.json`,
		bytes.value,
	);
	if (!moved.ok) {
		return fail(
			"CDX-E903",
			moved.error.message,
			moved.error.remediation,
			req.json,
		);
	}
	await ports.value.fs.remove(`${TASKS_DIR}/${id}.json`);
	printHuman(`closed ${id}`, req.quiet);
	return ok(0);
}

// SPEC §4.12.2: task advancement. Phase order follows the seven mandatory
// phases through the owning gate; checkpoint and close are cache state,
// while ack clears an escalation and stays human-only.
import { parseArgs } from "node:util";
import type { TaskRecord } from "../features/workflow/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	checkHuman,
	commandEnv,
	fail,
	needTaskRoot,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";
import { taskPhaseNext } from "./task-phases.ts";
import {
	listTaskIds,
	readTask,
	taskCheckpoint,
	taskClose,
	taskLine,
	taskNew,
	writeTask,
} from "./tasks.ts";

async function taskAck(
	req: CommandRequest,
	root: string,
	task: TaskRecord,
	id: string,
	note: string,
): Promise<Result<number>> {
	const human = checkHuman(commandEnv(), []);
	if (!human.ok) {
		return fail(
			"CDX-E107",
			human.error.message,
			human.error.remediation,
			req.json,
		);
	}
	if (note === "") {
		return usageError("usage: codictator task ack --id <T-####> --note <text>");
	}
	const open = (task.escalations ?? []).filter(
		(entry) => entry.ackedBy === undefined,
	);
	if (open.length === 0) {
		printHuman(`no open escalations on ${id}`, req.quiet);
		return ok(0);
	}
	const acked: TaskRecord = {
		...task,
		escalations: (task.escalations ?? []).map((entry) =>
			entry.ackedBy === undefined
				? { ...entry, ackedBy: "human", note }
				: entry,
		),
	};
	const saved = await writeTask(root, acked);
	if (!saved.ok) {
		return saved;
	}
	printHuman(`acked ${open.length} escalation(s) on ${id}`, req.quiet);
	return ok(0);
}

async function taskAmend(
	req: CommandRequest,
	root: string,
	task: TaskRecord,
	title: string | undefined,
	type: string | undefined,
): Promise<Result<number>> {
	if (title === undefined && type === undefined) {
		return usageError(
			"usage: codictator task amend --id <T-####> [--title <t>] [--type <t>]",
		);
	}
	const amended: TaskRecord = {
		...task,
		...(title === undefined ? {} : { title }),
		...(type === undefined ? {} : { type }),
	};
	const saved = await writeTask(root, amended);
	if (!saved.ok) {
		return saved;
	}
	printHuman(`amended ${taskLine(amended)}`, req.quiet);
	return ok(0);
}

async function taskMutate(
	req: CommandRequest,
	root: string,
	sub: string,
): Promise<Result<number>> {
	let id = "";
	let title: string | undefined;
	let type: string | undefined;
	let note = "";
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: {
				id: { type: "string" },
				title: { type: "string" },
				type: { type: "string" },
				note: { type: "string", default: "" },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError(`usage: codictator task ${sub} --id <T-####> ...`);
		}
		id = parsed.values.id ?? "";
		title = parsed.values.title;
		type = parsed.values.type;
		note = parsed.values.note ?? "";
	} catch {
		return usageError(`usage: codictator task ${sub} --id <T-####> ...`);
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
	if (sub === "ack") {
		return taskAck(req, root, task, id, note);
	}
	if (sub === "amend") {
		return taskAmend(req, root, task, title, type);
	}
	return taskClose(req, root, id);
}

// SPEC §4.19.2 + §4.12: task lifecycle reads and writes; only ack is
// human-only, and only it clears an escalation.
export async function handleTask(req: CommandRequest): Promise<Result<number>> {
	const root = await needTaskRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const sub = req.args[0] ?? "";
	if (sub === "new") {
		return taskNew(req, root);
	}
	if (sub === "show") {
		return taskShow(req, root);
	}
	if (sub === "phase" && req.args[1] === "next") {
		return taskPhaseNext(req, root);
	}
	if (sub === "checkpoint") {
		return taskCheckpoint(req, root);
	}
	if (sub === "ack" || sub === "amend" || sub === "close") {
		return taskMutate(req, root, sub);
	}
	return usageError(
		"usage: codictator task <new|show|amend|phase next|checkpoint|close|ack> ...",
	);
}

async function taskShow(
	req: CommandRequest,
	root: string,
): Promise<Result<number>> {
	const ids = await listTaskIds(root);
	if (req.args.length === 1) {
		if (req.json) {
			printJson({ tasks: ids });
		} else if (ids.length === 0) {
			printHuman("no tasks recorded", req.quiet);
		} else {
			for (const id of ids) {
				const task = await readTask(root, id);
				printHuman(task === undefined ? id : taskLine(task), req.quiet);
			}
		}
		return ok(0);
	}
	const id = req.args[1] ?? "";
	const task = await readTask(root, id);
	if (task === undefined) {
		return fail(
			"CDX-E903",
			`no task record for "${id}"`,
			"List tasks with codictator task show, then retry.",
			req.json,
		);
	}
	if (req.json) {
		printJson(task);
	} else {
		printHuman(taskLine(task), req.quiet);
	}
	return ok(0);
}

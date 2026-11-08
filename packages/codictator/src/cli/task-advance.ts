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
import { taskAmend } from "./task-amend.ts";
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

async function taskMutate(
	req: CommandRequest,
	root: string,
	sub: string,
): Promise<Result<number>> {
	let id = "";
	let title: string | undefined;
	let type: string | undefined;
	let allow: Array<string> | undefined;
	let setAllow: Array<string> | undefined;
	let spec: Array<string> | undefined;
	let setSpec: Array<string> | undefined;
	let diagnosis: string | undefined;
	let accept: Array<string> | undefined;
	let setAccept: Array<string> | undefined;
	let test: Array<string> | undefined;
	let setTests: Array<string> | undefined;
	let historyStaged = false;
	let bugRowUpdated = false;
	let note = "";
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: {
				id: { type: "string" },
				title: { type: "string" },
				type: { type: "string" },
				allow: { type: "string", multiple: true },
				"set-allow": { type: "string", multiple: true },
				spec: { type: "string", multiple: true },
				"set-spec": { type: "string", multiple: true },
				diagnosis: { type: "string" },
				accept: { type: "string", multiple: true },
				"set-accept": { type: "string", multiple: true },
				test: { type: "string", multiple: true },
				"set-tests": { type: "string", multiple: true },
				"history-staged": { type: "boolean" },
				"bug-row-updated": { type: "boolean" },
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
		allow = parsed.values.allow;
		setAllow = parsed.values["set-allow"];
		spec = parsed.values.spec;
		setSpec = parsed.values["set-spec"];
		diagnosis = parsed.values.diagnosis;
		accept = parsed.values.accept;
		setAccept = parsed.values["set-accept"];
		test = parsed.values.test;
		setTests = parsed.values["set-tests"];
		historyStaged = parsed.values["history-staged"] ?? false;
		bugRowUpdated = parsed.values["bug-row-updated"] ?? false;
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
		return taskAmend(
			req,
			root,
			task,
			title,
			type,
			allow,
			setAllow,
			spec,
			setSpec,
			diagnosis,
			accept,
			setAccept,
			test,
			setTests,
			historyStaged,
			bugRowUpdated,
		);
	}
	return taskClose(req, root, id);
}

// SPEC §4.19.2 + §4.12: task lifecycle reads and writes; only ack is
// human-only, and only it clears an escalation.
type TaskSubcommand = (
	req: CommandRequest,
	root: string,
) => Promise<Result<number>>;

const SINGLE_SUBCOMMANDS: Readonly<Record<string, TaskSubcommand>> = {
	new: (req, root) => taskNew(req, root),
	show: (req, root) => taskShow(req, root),
	checkpoint: (req, root) => taskCheckpoint(req, root),
};

async function runTaskSub(
	req: CommandRequest,
	root: string,
	sub: string,
): Promise<Result<number>> {
	if (sub === "phase" && req.args[1] === "next") {
		return taskPhaseNext(req, root);
	}
	const single = SINGLE_SUBCOMMANDS[sub];
	if (single !== undefined) {
		return single(req, root);
	}
	if (sub === "ack" || sub === "amend" || sub === "close") {
		return taskMutate(req, root, sub);
	}
	return usageError(
		"usage: codictator task <new|show|amend|phase next|checkpoint|close|ack> ...",
	);
}

export async function handleTask(req: CommandRequest): Promise<Result<number>> {
	const root = await needTaskRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	return runTaskSub(req, root, req.args[0] ?? "");
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

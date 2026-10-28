// SPEC §4.10.2: red and green proofs attach the HEAD commit and tree to the
// task; the declared tests must have executed (titles listed on the command).
import { parseArgs } from "node:util";
import type { TaskRecord } from "../features/workflow/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	needTaskRoot,
	portsFor,
	printHuman,
	usageError,
} from "./shared.ts";
import { readTask, writeTask } from "./tasks.ts";

async function recordProof(
	req: CommandRequest,
	root: string,
	kind: string,
	titles: ReadonlyArray<string>,
	task: TaskRecord,
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
	const head = await ports.value.proc.run(["git", "rev-parse", "HEAD"], {
		cwd: root,
		env: {},
		timeoutMs: 15000,
		maxOutputBytes: 4096,
	});
	const tree = await ports.value.proc.run(["git", "rev-parse", "HEAD^{tree}"], {
		cwd: root,
		env: {},
		timeoutMs: 15000,
		maxOutputBytes: 4096,
	});
	if (head.code !== 0 || tree.code !== 0) {
		return fail(
			"CDX-E703",
			"cannot read the HEAD commit or tree",
			"Commit first, then retry.",
			req.json,
		);
	}
	const now = ports.value.clock.now();
	const proved: TaskRecord =
		kind === "red"
			? {
					...task,
					redProof: {
						commit: head.stdout.trim(),
						tree: tree.stdout.trim(),
						failing: [...titles],
						at: now,
					},
				}
			: { ...task, greenProof: { at: now, tree: tree.stdout.trim() } };
	const saved = await writeTask(root, proved);
	if (!saved.ok) {
		return saved;
	}
	printHuman(`recorded ${kind} proof for ${task.id}`, req.quiet);
	return ok(0);
}

export async function handleTestCmd(
	req: CommandRequest,
): Promise<Result<number>> {
	const kind = req.args[0] ?? "";
	if (kind !== "red" && kind !== "green") {
		return usageError(
			"usage: codictator test <red|green> --task <T-####> [<test title> ...]",
		);
	}
	let taskId = "";
	let titles: ReadonlyArray<string> = [];
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: { task: { type: "string" } },
			allowPositionals: true,
		});
		taskId = parsed.values.task ?? "";
		titles = [...parsed.positionals];
		if (taskId === "" || titles.length === 0) {
			return usageError(
				"usage: codictator test <red|green> --task <T-####> [<test title> ...]",
			);
		}
	} catch {
		return usageError(
			"usage: codictator test <red|green> --task <T-####> [<test title> ...]",
		);
	}
	const root = await needTaskRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const task = await readTask(root, taskId);
	if (task === undefined) {
		return fail(
			"CDX-E903",
			`no task record for "${taskId}"`,
			"Create it with codictator task new, then retry.",
			req.json,
		);
	}
	return recordProof(req, root, kind, titles, task);
}

// SPEC §4.12.2: task phase advancement. The next-phase gate check and the
// phase entry write live here; dispatch stays in task-advance.ts.
import { parseArgs } from "node:util";
import { readManifestPaths } from "../features/integrity/index.ts";
import {
	checkPhaseGate,
	MANDATORY_PHASES,
	type TaskRecord,
} from "../features/workflow/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import type { CommandRequest } from "./shared.ts";
import { fail, portsFor, printHuman, printJson, usageError } from "./shared.ts";
import { observeRecordEvidence } from "./task-record-evidence.ts";
import { readTask, writeTask } from "./tasks.ts";

async function gateForNextPhase(
	root: string,
	task: TaskRecord,
	next: string,
): Promise<
	ReadonlyArray<{ ruleId: string; message: string; remediation: string }>
> {
	// SPEC §4.14.1: a path the manifest lists is manifest-owned.
	const ports = await portsFor(root);
	const manifestPaths = ports.ok ? await readManifestPaths(ports.value) : [];
	const gate = await checkPhaseGate(task, next, { manifestPaths });
	return gate.map((finding) => ({
		ruleId: finding.ruleId,
		message: finding.message,
		remediation: finding.remediation,
	}));
}

// SPEC §4.12.2 row 6: leaving record observes the evidence itself and
// records it on the task; the self-declared amend flags still count.
async function observeRecord(
	root: string,
	task: TaskRecord,
): Promise<TaskRecord> {
	if (task.phase !== "record") {
		return task;
	}
	const ports = await portsFor(root);
	if (!ports.ok) {
		return task;
	}
	const seen = await observeRecordEvidence(ports.value, task);
	const historyStaged = task.historyStaged === true || seen.historyStaged;
	const bugRowUpdated = task.bugRowUpdated === true || seen.bugRowUpdated;
	if (
		historyStaged === (task.historyStaged === true) &&
		bugRowUpdated === (task.bugRowUpdated === true)
	) {
		return task;
	}
	return {
		...task,
		...(historyStaged ? { historyStaged: true } : {}),
		...(bugRowUpdated ? { bugRowUpdated: true } : {}),
	};
}

async function applyPhaseEntry(
	root: string,
	task: TaskRecord,
	next: string,
	now: string,
): Promise<Result<number>> {
	const moved: TaskRecord = {
		...task,
		phase: next,
		phases: [
			...task.phases,
			{ name: next, enteredAt: now, evidence: "codictator task phase next" },
		],
	};
	return writeTask(root, moved);
}

export async function taskPhaseNext(
	req: CommandRequest,
	root: string,
): Promise<Result<number>> {
	let id = "";
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(2)],
			options: { id: { type: "string" } },
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator task phase next --id <T-####>");
		}
		id = parsed.values.id ?? "";
	} catch {
		return usageError("usage: codictator task phase next --id <T-####>");
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
	const at = MANDATORY_PHASES.indexOf(task.phase);
	const next = at >= 0 ? MANDATORY_PHASES[at + 1] : undefined;
	if (next === undefined) {
		return fail(
			"CDX-E604",
			`task ${id} is past its last phase`,
			"Close the task instead.",
			req.json,
		);
	}
	const observed = await observeRecord(root, task);
	if (observed !== task) {
		const kept = await writeTask(root, observed);
		if (!kept.ok) {
			return kept;
		}
	}
	const blocked = await gateForNextPhase(root, observed, next);
	if (blocked.length > 0) {
		if (req.json) {
			printJson({ id, phase: task.phase, blocked });
		} else {
			for (const finding of blocked) {
				printHuman(`${finding.ruleId}  ${finding.message}`, req.quiet);
				printHuman(`Do instead: ${finding.remediation}`, req.quiet);
			}
		}
		return ok(1);
	}
	const ports = await portsFor(root);
	const saved = await applyPhaseEntry(
		root,
		observed,
		next,
		ports.ok ? ports.value.clock.now() : "",
	);
	if (!saved.ok) {
		return saved;
	}
	if (req.json) {
		printJson({ id, phase: next });
	} else {
		printHuman(`task ${id} entered ${next}`, req.quiet);
	}
	return ok(0);
}

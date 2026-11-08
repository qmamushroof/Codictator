// SPEC §4.6.3: the active-task summary behind the scoped injection. The
// hook runtime renders the injection from committed state, so this helper
// reads the task records the CLI owns (§4.12.1) and names the task id,
// phase, next gate and the command that satisfies it. Branch resolution
// failures fall back to no active task: the injection advises, so an
// unreadable branch never blocks session start (fail-closed stays with
// the L1 verdict path of Slice 1).
import type { Ports } from "../../kernel/index.ts";
import { parseJson } from "../../kernel/index.ts";
import { resolveActiveTask, type TaskRecord } from "../workflow/index.ts";

// The task-record directory the CLI owns (§4.12.1); scope-tasks.ts in
// packs reads the same directory, but adapters cannot import packs
// (§3.3), so the filename check lives here with the steering reader.
const TASKS_DIR = ".codictator/tasks";

// SPEC §4.12.2: the gate that releases each phase, with the command that
// records its evidence. Custom phases fall back to the advance command.
const NEXT_GATE: Readonly<Record<string, { gate: string; command: string }>> = {
	discovery: {
		gate: "spec refs listed and resolving",
		command: "codictator task amend --spec <SPEC ref>",
	},
	planning: {
		gate: "red proof of declared tests",
		command: "codictator test red",
	},
	implementation: {
		gate: "implement files.allow, then green proof",
		command: "codictator test green",
	},
	validation: {
		gate: "green proof and verify --staged passing",
		command: "codictator verify --staged",
	},
	review: {
		gate: "review gate with no open blockers or majors",
		command: "codictator review submit --task <id> --findings <file>",
	},
	record: {
		gate: "HISTORY entry staged (fix: bug row updated)",
		command: "codictator task phase next",
	},
	integrate: {
		gate: "commit, push and PR merged on green",
		command: "codictator task phase next",
	},
};

// The injection slice resolved from committed state for one session; the
// runtime threads it into the scoped injection renderer (§4.6.3 table).
export interface TaskInjection {
	readonly taskSummary: string;
	readonly allowedFiles: ReadonlyArray<string>;
	readonly testSummary: string;
	readonly reviewFindings: string;
}

function narrowTaskRecord(value: unknown): TaskRecord | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as TaskRecord;
	if (record.version !== 1 || typeof record.id !== "string") {
		return undefined;
	}
	return record;
}

async function readTaskRecords(ports: Ports): Promise<Array<TaskRecord>> {
	const listed = await ports.fs.list(TASKS_DIR);
	if (!listed.ok) {
		return [];
	}
	const out: Array<TaskRecord> = [];
	for (const name of [...listed.value].sort()) {
		if (!name.endsWith(".json")) {
			continue;
		}
		const text = await ports.fs.readText(`${TASKS_DIR}/${name}`);
		if (!text.ok) {
			continue;
		}
		const parsed = parseJson(text.value);
		if (!parsed.ok) {
			continue;
		}
		const record = narrowTaskRecord(parsed.value);
		if (record !== undefined) {
			out.push(record);
		}
	}
	return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// The branch the task binds to (§4.12.1), through the honored git port;
// an unreadable branch means no active task, never a hook failure.
async function branchOf(
	ports: Ports,
	root: string,
): Promise<string | undefined> {
	const ran = await ports.proc.run(["git", "branch", "--show-current"], {
		cwd: root,
		env: {},
		timeoutMs: 15000,
		maxOutputBytes: 4096,
	});
	const branch = ran.stdout.trim();
	return ran.code === 0 && branch !== "" ? branch : undefined;
}

// Malformed records (hand edits, foreign files) degrade to empty lists,
// never a throw: the injection advises, so it stays total.
function allowedFilesOf(task: TaskRecord): ReadonlyArray<string> {
	const allow = task.files?.allow;
	if (!Array.isArray(allow)) {
		return [];
	}
	return allow.filter((entry): entry is string => typeof entry === "string");
}

function testSummaryOf(task: TaskRecord): string {
	const declared = Array.isArray(task.tests) ? task.tests : [];
	if (declared.length === 0) {
		return "(none declared)";
	}
	const red = task.redProof === undefined ? "missing" : "recorded";
	const green = task.greenProof === undefined ? "missing" : "recorded";
	return `${String(declared.length)} declared; red proof ${red}; green proof ${green}`;
}

function reviewFindingsOf(task: TaskRecord): string {
	const rounds = Array.isArray(task.reviews) ? task.reviews : [];
	if (rounds.length === 0) {
		return "(none)";
	}
	const last = rounds[rounds.length - 1];
	if (last === undefined) {
		return "(none)";
	}
	return `round ${String(last.round)}: ${String(last.openBlockers)} blockers, ${String(last.openMajors)} majors open`;
}

// SPEC §4.6.3: the active task for the branch, or undefined when there is
// none (no records, unreadable branch, or nothing bound to this branch).
export async function activeTaskInjection(
	ports: Ports,
	root: string,
): Promise<TaskInjection | undefined> {
	const branch = await branchOf(ports, root);
	if (branch === undefined) {
		return undefined;
	}
	const task = resolveActiveTask(await readTaskRecords(ports), branch);
	if (task === undefined) {
		return undefined;
	}
	const next = NEXT_GATE[task.phase] ?? {
		gate: "phase gate in config.workflow",
		command: "codictator task phase next",
	};
	return {
		taskSummary: `Task ${task.id} [${task.type}] ${task.phase}. Next gate: ${next.gate} (${next.command}).`,
		allowedFiles: allowedFilesOf(task),
		testSummary: testSummaryOf(task),
		reviewFindings: reviewFindingsOf(task),
	};
}

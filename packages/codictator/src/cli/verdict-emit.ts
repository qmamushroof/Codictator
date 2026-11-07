// SPEC §4.18.1 + §7.10: the CLI verdict emit. Gates that pass emit land
// their auditable verdict through the same appendEvent the hook runtime
// uses, so commit, push, verify and CI blocks reach the Timeline with
// their layer, trigger, task and packs. Reads (findings/list, L2) never
// pass emit, so they stay silent.
import { appendEvent, type NewEvent } from "../features/audit/index.ts";
import { type EngineOptions, packsRecord } from "../features/engine/index.ts";
import { parseJson, type Result } from "../kernel/index.ts";
import type { CommandPorts } from "./shared.ts";

export interface VerdictEmit {
	readonly harness: string;
	readonly packs: Readonly<Record<string, string>>;
	readonly append: (event: NewEvent) => Promise<Result<void>>;
	readonly taskId?: string;
}

export interface EvaluateOptions {
	readonly excludeRuleIds?: ReadonlySet<string>;
	readonly emit?: VerdictEmit;
}

// SPEC §4.18: the engine options carry the emit's packs and append, so a
// gate without emit judges bare while a gate with emit lands its verdict.
export function emitEngineOptions(
	configHash: string,
	emit: VerdictEmit | undefined,
): EngineOptions {
	return {
		configHash,
		packs: emit?.packs ?? {},
		...(emit?.append === undefined ? {} : { append: emit.append }),
	};
}

// SPEC §4.1.1: the CLI verdict sink. Ports stay root-confined, so the log
// append rides the logical root like the hook runtime's own sink.
function verdictSink(ports: CommandPorts): VerdictEmit["append"] {
	return (event: NewEvent): Promise<Result<void>> =>
		appendEvent(ports, ".", event);
}

async function currentBranch(ports: CommandPorts): Promise<string | undefined> {
	const ran = await ports.proc.run(["git", "branch", "--show-current"], {
		cwd: ports.root,
		env: {},
		timeoutMs: 15000,
		maxOutputBytes: 4096,
	});
	if (ran.timedOut || ran.truncated || ran.code !== 0) {
		return undefined;
	}
	const branch = ran.stdout.trim();
	return branch === "" ? undefined : branch;
}

function taskIdOf(text: string, branch: string): string | undefined {
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return undefined;
	}
	const record = parsed.value as {
		readonly branch?: unknown;
		readonly id?: unknown;
	};
	if (record.branch !== branch) {
		return undefined;
	}
	return typeof record.id === "string" && record.id !== ""
		? record.id
		: undefined;
}

// SPEC §4.12.1: the branch task is the active task, so CLI verdicts carry
// its id the way hook verdicts do. Best-effort: no branch, no tasks dir or
// an unreadable record leaves the verdict untagged instead of failing.
async function activeTaskId(ports: CommandPorts): Promise<string | undefined> {
	const branch = await currentBranch(ports);
	if (branch === undefined) {
		return undefined;
	}
	const listed = await ports.fs.list(".codictator/tasks");
	if (!listed.ok) {
		return undefined;
	}
	for (const name of [...listed.value].sort()) {
		if (!name.endsWith(".json")) {
			continue;
		}
		const text = await ports.fs.readText(`.codictator/tasks/${name}`);
		if (!text.ok) {
			continue;
		}
		const id = taskIdOf(text.value, branch);
		if (id !== undefined) {
			return id;
		}
	}
	return undefined;
}

// The emit enriches the engine verdict with its source before the log
// owns it; the engine never sees harness or task routing.
function emittedEvent(
	event: NewEvent,
	harness: string,
	packs: Readonly<Record<string, string>>,
	taskId: string | undefined,
): NewEvent {
	return {
		...event,
		harness,
		packs,
		...(taskId === undefined ? {} : { taskId }),
	};
}

// One call builds the whole gate emit: tasked, packed and sunk.
export async function gateVerdict(
	ports: CommandPorts,
	harness: string,
	packEntries: ReadonlyArray<{
		readonly id: string;
		readonly version?: string;
	}>,
	engineVersion: string,
): Promise<VerdictEmit> {
	const sink = verdictSink(ports);
	const taskId = await activeTaskId(ports);
	const packs = packsRecord(packEntries, engineVersion);
	return {
		harness,
		packs,
		append: (event: NewEvent): Promise<Result<void>> =>
			sink(emittedEvent(event, harness, packs, taskId)),
		...(taskId === undefined ? {} : { taskId }),
	};
}

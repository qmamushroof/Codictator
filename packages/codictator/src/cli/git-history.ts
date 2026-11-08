// Hook-scope git history judging (split from git-hook.ts by file size):
// staged history text judged as ADDED entries through records/history
// checks, plus the SPEC §4.12.3 L3 hook-owned gates: pre-commit needs an
// active task at phase record or later on a code-class staged set, and
// commit-msg needs a staged history entry on a code/docs-class staged set.
// Gate evaluation stays in git-eval.ts; dispatch in git-hook.ts.
import { touchesOnlyManifests } from "../features/ci/index.ts";
import { entryFinding } from "../features/records/history-checks.ts";
import { checkHistory } from "../features/records/history-scope.ts";
import {
	classifyChange,
	MANDATORY_PHASES,
	resolveActiveTask,
	type TaskRecord,
} from "../features/workflow/index.ts";
import type { Finding, Result } from "../kernel/index.ts";
import { err, makeError, ok, parseJson } from "../kernel/index.ts";
import type { CommandPorts } from "./shared.ts";

const GIT_TIMEOUT_MS = 30000;
const GIT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export const GIT_TIMEOUT = GIT_TIMEOUT_MS;
export const GIT_OUTPUT_LIMIT = GIT_MAX_OUTPUT_BYTES;

export async function runGitText(
	ports: CommandPorts,
	argv: ReadonlyArray<string>,
): Promise<Result<string>> {
	const ran = await ports.proc.run(argv, {
		cwd: ports.root,
		env: {},
		timeoutMs: GIT_TIMEOUT_MS,
		maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
	});
	if (ran.timedOut || ran.truncated || ran.code !== 0) {
		return err(
			makeError(
				"CDX-E703",
				`git ${argv[1] ?? ""} failed while reading the hook scope`,
				"Run inside a git repository with git on PATH.",
			),
		);
	}
	return ok(ran.stdout);
}

// SPEC §4.9.4 + §4.9 EC-22: hook and CI scopes fall back to tracked
// BUGS rows. Enforcers read worktree text for in-scope paths, so a committed BUGS file
// loads identically whether staged or appended here from HEAD. BUG-0065
// follow-up: a fix scope staging no docs/BUGS/ file left bugRegistryReal
// with zero rows and a false unknown-bug block on an already-fixed row.
export async function withTrackedBugsFallback(
	ports: CommandPorts,
	files: ReadonlyArray<string>,
): Promise<Array<string>> {
	if (files.some((file) => file.startsWith("docs/BUGS/"))) {
		return [...files];
	}
	const listed = await runGitText(ports, [
		"git",
		"ls-tree",
		"HEAD",
		"--name-only",
		"--",
		"docs/BUGS/",
	]);
	if (!listed.ok) {
		return [...files];
	}
	const extra = listed.value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.filter((entry) => !files.includes(entry));
	return [...files, ...extra];
}

// SPEC §4.12.2 deps class + §4.9 EC-22: manifests and lockfiles only. The
// chore class covers manifest-owned paths; touchesOnlyManifests covers the
// remaining lockfile and bot-config basenames. Bot dependency updates take
// this path, so the task and history gates below exempt exactly what
// qualifyBotChange accepts without an entry.
function isDepsShapedChange(files: ReadonlyArray<string>): boolean {
	return classifyChange(files) === "chore" || touchesOnlyManifests(files);
}

// SPEC §4.12.2: record and integrate sit at or past record in the mandatory
// order; custom phases fail closed because they are not in that order.
function atRecordOrLater(phase: string): boolean {
	return MANDATORY_PHASES.indexOf(phase) >= MANDATORY_PHASES.indexOf("record");
}

async function branchName(ports: CommandPorts): Promise<string | undefined> {
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

async function taskEntry(
	ports: CommandPorts,
	name: string,
): Promise<TaskRecord | undefined> {
	if (!name.endsWith(".json")) {
		return undefined;
	}
	const text = await ports.fs.readText(`.codictator/tasks/${name}`);
	if (!text.ok) {
		return undefined;
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return undefined;
	}
	const record = parsed.value as TaskRecord;
	if (
		record.version !== 1 ||
		typeof record.id !== "string" ||
		typeof record.branch !== "string" ||
		typeof record.phase !== "string"
	) {
		return undefined;
	}
	return record;
}

// SPEC §4.12.1: the branch task is the active task for every hook on that
// branch. Unreadable state degrades to no task so the gates fail closed.
export async function readActiveTask(
	ports: CommandPorts,
): Promise<{ branch: string | undefined; task: TaskRecord | undefined }> {
	const branch = await branchName(ports);
	if (branch === undefined) {
		return { branch, task: undefined };
	}
	const listed = await ports.fs.list(".codictator/tasks");
	if (!listed.ok) {
		return { branch, task: undefined };
	}
	const records: Array<TaskRecord> = [];
	for (const name of [...listed.value].sort()) {
		const record = await taskEntry(ports, name);
		if (record !== undefined) {
			records.push(record);
		}
	}
	return { branch, task: resolveActiveTask(records, branch) };
}

function taskGateBlock(
	branch: string | undefined,
	task: TaskRecord | undefined,
): { message: string; remediation: string } | undefined {
	if (branch === undefined) {
		return {
			message: "commit on a code-class change with no readable branch",
			remediation: "Commit from a git branch with an active task, then retry.",
		};
	}
	if (task === undefined) {
		return {
			message: `commit with no active task on branch "${branch}"`,
			remediation:
				"Run codictator task new --type <type> --title ... to open the branch task.",
		};
	}
	if (!atRecordOrLater(task.phase)) {
		return {
			message: `commit before phase record (task ${task.id} in ${task.phase})`,
			remediation: `Run codictator task phase next to advance ${task.id}, then retry.`,
		};
	}
	return undefined;
}

// SPEC §4.12.3 L3: pre-commit on a code-class staged set needs an active
// task at phase record or later. Docs-only sets owe the history entry at
// commit-msg instead; deps-shaped sets owe neither (SPEC §4.12.7 EC-12).
export async function checkPreCommitTaskGate(
	ports: CommandPorts,
	files: ReadonlyArray<string>,
): Promise<Array<Finding>> {
	if (files.length === 0 || isDepsShapedChange(files)) {
		return [];
	}
	if (classifyChange(files) !== "code") {
		return [];
	}
	const { branch, task } = await readActiveTask(ports);
	const blocked = taskGateBlock(branch, task);
	if (blocked === undefined) {
		return [];
	}
	return [{ ruleId: "core/workflow-gates", ...blocked }];
}

// SPEC §4.12.3 L3 + §4.9.3: commit-msg on a code/docs-class staged set owes
// a staged docs/HISTORY/ entry. A bot change touching anything beyond
// manifests owes the entry like any other change (§4.15.3).
export function checkMissingHistoryEntry(
	files: ReadonlyArray<string>,
): Array<Finding> {
	if (files.length === 0 || isDepsShapedChange(files)) {
		return [];
	}
	const changeClass = classifyChange(files);
	if (changeClass !== "code" && changeClass !== "docs") {
		return [];
	}
	return [
		entryFinding(
			"core/history-entry",
			"commit stages no history entry",
			"docs/HISTORY/",
		),
	];
}

// SPEC §4.9.3 + §4.12.3 L3: the pre-commit history verdict. When the
// staged change carries a history file, its staged text is judged through
// records/history-scope.ts checkHistory (count, completeness, append-only
// against HEAD). Without a staged history file there is no entry to judge
// yet — the record phase stages it later — so the gate judges alone.
export async function checkStagedHistory(
	ports: CommandPorts,
	files: ReadonlyArray<string>,
	now: string,
	configHash: string,
): Promise<Array<Finding>> {
	const historyPath = [...files]
		.filter((file) => file.startsWith("docs/HISTORY/"))
		.sort()[0];
	if (historyPath === undefined) {
		return [];
	}
	const staged = await runGitText(ports, ["git", "show", `:${historyPath}`]);
	if (!staged.ok) {
		return [];
	}
	const base = await runGitText(ports, ["git", "show", `HEAD:${historyPath}`]);
	return checkHistory(
		{
			trigger: "pre-tool",
			scope: { files: [...files] },
			now,
			configHash,
		},
		staged.value,
		base.ok ? base.value : undefined,
		undefined,
	);
}

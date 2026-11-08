// Hook-scope git history judging (split from git-hook.ts by file size):
// staged history text judged as ADDED entries through records/history
// checks. Gate evaluation stays in git-eval.ts; dispatch in git-hook.ts.
import { checkHistory } from "../features/records/history-scope.ts";
import type { Finding, Result } from "../kernel/index.ts";
import { err, makeError, ok } from "../kernel/index.ts";
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

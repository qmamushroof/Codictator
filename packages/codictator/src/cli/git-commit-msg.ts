// Split from git-hook.ts by responsibility (core/file-size): this module
// owns the commit-msg hook path — the staged history validation and the
// Codictator-L3 trailer append — while git-hook.ts keeps hook dispatch and
// the pre-commit/pre-push legs.
import path from "node:path";
import { checkAddedHistoryEntryCount } from "../features/records/history-checks.ts";
import type { Result } from "../kernel/index.ts";
import { ok, readHostText, writeHostText } from "../kernel/index.ts";
import { emitGitVerdict } from "./git-eval.ts";
import { checkMissingHistoryEntry, runGitText } from "./git-history.ts";
import type { CommandPorts, CommandRequest } from "./shared.ts";
import { reportError, usageError } from "./shared.ts";

// SPEC §4.14.4: git hands commit-msg the COMMIT_EDITMSG path, absolute in a
// linked worktree (under the main repo's .git/worktrees/<name>/ dir, outside
// the worktree root) but relative to the repo root (`.git/COMMIT_EDITMSG`)
// in the main worktree. The confined Fs port rejects absolute paths
// (CDX-E701), so the hook uses kernel-owned host I/O — which itself
// requires absolute paths — resolving a relative handoff against the
// invocation cwd first; an unreadable or unwritable message file blocks
// fail-closed.
// SPEC §4.14.4 + §4.9.3: commit-msg validates the staged history entry
// count and subject before appending the trailer; a merge in progress
// (MERGE_HEAD) is exempt and only gets the trailer. Without a staged history
// file there is no entry to judge, so the trailer append stands alone; an
// unreadable staged entry degrades the same way instead of false-blocking
// (the pre-commit verdict already judged the staged text).
export async function runCommitMsg(
	req: CommandRequest,
	ports: CommandPorts,
	configHash: string,
): Promise<Result<number>> {
	if (req.args.length !== 2 || req.args[1] === undefined) {
		return usageError("usage: codictator git commit-msg <file>");
	}
	const raw = req.args[1];
	const file = path.isAbsolute(raw) ? raw : path.resolve(req.cwd, raw);
	const trailer = `Codictator-L3: ${configHash.slice(0, 12)}`;
	const read = await readHostText(file);
	if (!read.ok) {
		return reportError(read.error, req.json);
	}
	if (
		read.value.split("\n").some((line) => line.startsWith("Codictator-L3: "))
	) {
		return ok(0);
	}
	// SPEC §4.9.3 Exempt: a merge commit owes no history entry of its own.
	// The index differs from the first parent by the merged branch's own
	// entries, which the merge did not add, so only the trailer is appended.
	const merging = await runGitText(ports, [
		"git",
		"rev-parse",
		"-q",
		"--verify",
		"MERGE_HEAD",
	]);
	const names = merging.ok
		? undefined
		: await runGitText(ports, ["git", "diff", "--cached", "--name-only", "--"]);
	if (names?.ok) {
		const stagedFiles = names.value
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
		const historyPath = stagedFiles
			.filter((entry) => entry.startsWith("docs/HISTORY/"))
			.sort()[0];
		if (historyPath === undefined) {
			// SPEC §4.12.3 L3 + §4.9.3: a code/docs-class change with no
			// staged history entry blocks here. The deps-shaped path keeps
			// the trailer-only flow, so no entry is owed yet.
			const missing = checkMissingHistoryEntry(stagedFiles);
			if (missing.length > 0) {
				return emitGitVerdict(req, "commit-msg", missing);
			}
		} else {
			const staged = await runGitText(ports, [
				"git",
				"show",
				`:${historyPath}`,
			]);
			if (staged.ok) {
				// SPEC §4.9.3: judge the ADDED entry (staged minus HEAD),
				// not the whole accumulated file; tolerate a missing HEAD
				// base for brand-new history files.
				const base = await runGitText(ports, [
					"git",
					"show",
					`HEAD:${historyPath}`,
				]);
				const subject = read.value
					.split("\n")
					.map((line) => line.trim())
					.find((line) => line !== "" && !line.startsWith("#"));
				const entryFindings = checkAddedHistoryEntryCount(
					staged.value,
					base.ok ? base.value : undefined,
					historyPath,
					subject === undefined || subject === "" ? undefined : subject,
				);
				if (entryFindings.length > 0) {
					return emitGitVerdict(req, "commit-msg", entryFindings);
				}
			}
		}
	}
	const base = read.value.endsWith("\n") ? read.value : `${read.value}\n`;
	const wrote = await writeHostText(file, `${base}\n${trailer}\n`);
	if (!wrote.ok) {
		return reportError(wrote.error, req.json);
	}
	return ok(0);
}

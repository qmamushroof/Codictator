// SPEC §4.14.4 + §4.7: the git-hook engine path. Installed hooks exec
// the launcher as `run.mjs git <hook>`; the launcher routes the `git` word
// here (SPEC §4.19.3). pre-commit and pre-push evaluate the staged or pushed
// the change with the gate rule subset `verify` loads over staged scopes —
// new scope plumbing, no new detection logic. commit-msg appends
// the Codictator-L3 trailer §4.14.2 checks at L4.

import path from "node:path";
import { ENGINE_VERSION, HOOK_MARKER } from "../features/config/index.ts";
import { checkAddedHistoryEntryCount } from "../features/records/history-checks.ts";
import type { Env, Result } from "../kernel/index.ts";
import { ok, readHostText, writeHostText } from "../kernel/index.ts";
import { emitGitVerdict, evaluateGitChange } from "./git-eval.ts";
import { checkStagedHistory, runGitText, withTrackedBugsFallback } from "./git-history.ts";
import type { CommandPorts, CommandRequest } from "./shared.ts";
import {
	commandEnv,
	fail,
	loadRepoConfig,
	MIN_NODE_MAJOR,
	needRoot,
	nodeMajor,
	nodeTooOldMessage,
	reportError,
	usageError,
} from "./shared.ts";
import { gateVerdict, type VerdictEmit } from "./verdict-emit.ts";

// SPEC §4.7.1: L3 scans staged content. The staged file list scopes the
// disk reads while the staged diff rides as proposed content, so a secret
// staged but not yet matching the worktree still blocks.
async function runPreCommit(
	req: CommandRequest,
	ports: CommandPorts,
	packIds: ReadonlyArray<string>,
	now: string,
	configHash: string,
	emit: VerdictEmit,
): Promise<Result<number>> {
	const staged = await ports.git.stagedFiles();
	if (!staged.ok) {
		return reportError(staged.error, req.json);
	}
	if (staged.value.length === 0) {
		return emitGitVerdict(req, "pre-commit", []);
	}
	const diff = await runGitText(ports, ["git", "diff", "--cached", "--"]);
	if (!diff.ok) {
		return reportError(diff.error, req.json);
	}
	const historyFindings = await checkStagedHistory(
		ports,
		staged.value,
		now,
		configHash,
	);
	const scoped = await withTrackedBugsFallback(ports, staged.value);
	return evaluateGitChange(
		ports,
		req,
		"pre-commit",
		packIds,
		scoped,
		diff.value,
		now,
		configHash,
		emit,
		historyFindings,
	);
}

// SPEC §4.14.4: git hands commit-msg the COMMIT_EDITMSG path, absolute in a
// linked worktree (under the main repo's .git/worktrees/<name>/ dir, outside
// the worktree root) but relative to the repo root (`.git/COMMIT_EDITMSG`)
// in the main worktree. The confined Fs port rejects absolute paths
// (CDX-E701), so the hook uses kernel-owned host I/O — which itself
// requires absolute paths — resolving a relative handoff against the
// invocation cwd first; an unreadable or unwritable message file blocks
// fail-closed.
// SPEC §4.14.4 + §4.9.3: commit-msg validates the staged history entry
// count and subject before appending the trailer. Without a staged history
// file there is no entry to judge, so the trailer append stands alone; an
// unreadable staged entry degrades the same way instead of false-blocking
// (the pre-commit verdict already judged the staged text).
async function runCommitMsg(
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
	const names = await runGitText(ports, [
		"git",
		"diff",
		"--cached",
		"--name-only",
		"--",
	]);
	if (names.ok) {
		const historyPath = names.value
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "")
			.filter((entry) => entry.startsWith("docs/HISTORY/"))
			.sort()[0];
		if (historyPath !== undefined) {
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

// SPEC §4.3.2: pre-push judges the `@{push}..HEAD` diff. Without an
// upstream there is no pushed range; the commits were gated at commit time.
async function runPrePush(
	req: CommandRequest,
	ports: CommandPorts,
	packIds: ReadonlyArray<string>,
	now: string,
	configHash: string,
	emit: VerdictEmit,
): Promise<Result<number>> {
	const upstream = await runGitText(ports, [
		"git",
		"rev-parse",
		"--verify",
		"@{push}",
	]);
	if (!upstream.ok || upstream.value.trim() === "") {
		return emitGitVerdict(req, "pre-push", []);
	}
	const base = upstream.value.trim(); // BUG-0043 ACMR only: a pushed deletion has no worktree content.
	const names = await runGitText(ports, [
		"git",
		"diff",
		"--name-only",
		"--diff-filter=ACMR",
		base,
		"HEAD",
		"--",
	]);
	if (!names.ok) {
		return reportError(names.error, req.json);
	}
	const diff = await runGitText(ports, ["git", "diff", base, "HEAD", "--"]);
	if (!diff.ok) {
		return reportError(diff.error, req.json);
	}
	const files = names.value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const scoped = await withTrackedBugsFallback(ports, files);
	return evaluateGitChange(
		ports,
		req,
		"pre-push",
		packIds,
		scoped,
		diff.value,
		now,
		configHash,
		emit,
	);
}

// SPEC §4.2.3 with §4.19.3, same shape as the L1 runtime hookEnv: the
// launcher marks this engine process CODICTATOR_HOOK=1, which authorizes
// evaluation instead of refusing it. Only the launcher's own marker is
// hidden, so a foreign agent marker still refuses CDX-E107 in loadConfig.
function hookEnv(inner: Env): Env {
	return {
		get: (name: string): string | undefined =>
			name === HOOK_MARKER ? undefined : inner.get(name),
	};
}

// SPEC §4.19.3: the `git` word entry. Args arrive without the word itself:
// `pre-commit`, `commit-msg <file>` or `pre-push`. Unknown hooks are usage
// errors (exit 2); every evaluation failure blocks.
export async function handleGitHook(
	req: CommandRequest,
): Promise<Result<number>> {
	const version = req.nodeVersion ?? process.version;
	if (nodeMajor(version) < MIN_NODE_MAJOR) {
		return fail(
			"CDX-E002",
			nodeTooOldMessage(version),
			"Install a newer Node, then retry the hook.",
			req.json,
		);
	}
	const hook = req.args[0] ?? "";
	if (hook !== "pre-commit" && hook !== "commit-msg" && hook !== "pre-push") {
		return usageError(
			"usage: codictator git <pre-commit|commit-msg <file>|pre-push>",
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const engineVersion = req.engineVersion ?? ENGINE_VERSION;
	const configured = await loadRepoConfig(
		root,
		hookEnv(commandEnv()),
		engineVersion,
	);
	if (!configured.ok) {
		return fail(
			configured.error.code,
			configured.error.message,
			"Fix .codictator/config.json, then retry.",
			req.json,
		);
	}
	const ports = configured.value.ports;
	const packIds = configured.value.effective.config.packs.map(
		(entry) => entry.id,
	);
	const now = ports.clock.now();
	const configHash = configured.value.effective.configHash;
	if (hook === "commit-msg") {
		return runCommitMsg(req, ports, configHash);
	}
	// SPEC §4.18: the hook verdict carries the evaluated packs and the
	// branch task, so the Timeline row names what judged the change.
	const emit = await gateVerdict(
		ports,
		"git",
		configured.value.effective.config.packs,
		engineVersion,
	);
	if (hook === "pre-push") {
		return runPrePush(req, ports, packIds, now, configHash, emit);
	}
	return runPreCommit(req, ports, packIds, now, configHash, emit);
}

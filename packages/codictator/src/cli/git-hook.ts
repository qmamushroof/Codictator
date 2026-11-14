// SPEC §4.14.4 + §4.7: the git-hook engine path. Installed hooks exec
// the launcher as `run.mjs git <hook>`; the launcher routes the `git` word
// here (SPEC §4.19.3). pre-commit and pre-push evaluate the staged or pushed
// the change with the gate rule subset `verify` loads over staged scopes —
// new scope plumbing, no new detection logic. commit-msg lives in
// git-commit-msg.ts; it appends the Codictator-L3 trailer §4.14.2 checks
// at L4.

import { ENGINE_VERSION, HOOK_MARKER } from "../features/config/index.ts";
import type { Env, Result } from "../kernel/index.ts";
import { runCommitMsg } from "./git-commit-msg.ts";
import { emitGitVerdict, evaluateGitChange } from "./git-eval.ts";
import {
	checkPreCommitTaskGate,
	checkStagedHistory,
	runGitText,
	withTrackedBugsFallback,
} from "./git-history.ts";
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
	// SPEC §4.12.3 L3: the task gate rides in the same verdict as the gate
	// legs, so a code commit with no task (or a task below record) blocks.
	const taskFindings = await checkPreCommitTaskGate(ports, staged.value);
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
		[...historyFindings, ...taskFindings],
	);
}

// SPEC §4.3.2 pre-push range: the diff base is the first parent of the
// oldest commit reachable from HEAD but from neither @{push} nor the
// default branch's remote ref (BUG-0092), so a rebased branch is not judged
// for commits already merged there. Undefined means no commit of its own.
// Every unreadable input, a root commit or a merge in range falls back to
// the wider @{push} base, so the gate never narrows on a guess.
async function pushedBase(
	ports: CommandPorts,
	upstream: string,
): Promise<string | undefined> {
	const head = await runGitText(ports, [
		"git",
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
	]);
	const defaultRef = head.ok ? head.value.trim() : "";
	if (defaultRef === "") {
		return upstream;
	}
	const resolved = await runGitText(ports, [
		"git",
		"rev-parse",
		"--verify",
		defaultRef,
	]);
	if (!resolved.ok || resolved.value.trim() === "") {
		return upstream;
	}
	const range = ["HEAD", "--not", upstream, resolved.value.trim()];
	const merges = await runGitText(ports, [
		"git",
		"rev-list",
		"--merges",
		...range,
	]);
	const own = await runGitText(ports, [
		"git",
		"rev-list",
		"--reverse",
		"--topo-order",
		...range,
	]);
	if (!merges.ok || !own.ok || merges.value.trim() !== "") {
		return upstream;
	}
	const oldest = own.value.split("\n")[0]?.trim() ?? "";
	if (oldest === "") {
		return undefined;
	}
	const parent = await runGitText(ports, [
		"git",
		"rev-parse",
		"--verify",
		`${oldest}^`,
	]);
	return parent.ok && parent.value.trim() !== ""
		? parent.value.trim()
		: upstream;
}

// SPEC §4.3.2: pre-push judges the branch's own commits (pushedBase).
// Without an upstream there is no pushed range; the commits were gated at
// commit time.
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
	const base = await pushedBase(ports, upstream.value.trim());
	if (base === undefined) {
		return emitGitVerdict(req, "pre-push", []);
	}
	// BUG-0043 ACMR only: a pushed deletion has no worktree content.
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

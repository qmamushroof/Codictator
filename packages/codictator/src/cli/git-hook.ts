// SPEC §4.14.4 + §4.7: the git-hook engine path. Installed hooks exec
// the launcher as `run.mjs git <hook>`; the launcher routes the `git` word
// here (SPEC §4.19.3). pre-commit and pre-push evaluate the staged or pushed
// change with the pre-tool gate family `verify` loads over staged scopes —
// new scope plumbing, no new detection logic. commit-msg appends
// the Codictator-L3 trailer §4.14.2 checks at L4.

import { HOOK_MARKER } from "../features/config/index.ts";
import type { Env, Finding, Result } from "../kernel/index.ts";
import { err, makeError, ok } from "../kernel/index.ts";
import { evaluateScope } from "./evaluate.ts";
import { printFinding } from "./inspect.ts";
import type { CommandPorts, CommandRequest } from "./shared.ts";
import {
	commandEnv,
	fail,
	loadRepoConfig,
	MIN_NODE_MAJOR,
	needRoot,
	nodeMajor,
	nodeTooOldMessage,
	printHuman,
	printJson,
	reportError,
	usageError,
} from "./shared.ts";

const GIT_TIMEOUT_MS = 30000;
const GIT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function encodeText(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

async function runGitText(
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

function emitGitVerdict(
	req: CommandRequest,
	hook: string,
	findings: ReadonlyArray<Finding>,
): Result<number> {
	if (req.json) {
		printJson({
			hook,
			decision: findings.length === 0 ? "allow" : "block",
			findings,
		});
	} else {
		for (const finding of findings) {
			printFinding(finding, req.quiet);
		}
		if (findings.length === 0) {
			printHuman(`${hook}: pass`, req.quiet);
		} else {
			printHuman(
				`${hook}: blocked (${String(findings.length)} findings)`,
				req.quiet,
			);
		}
	}
	return ok(findings.length === 0 ? 0 : 1);
}

async function evaluateGitChange(
	ports: CommandPorts,
	req: CommandRequest,
	hook: string,
	packIds: ReadonlyArray<string>,
	files: ReadonlyArray<string>,
	content: string,
	now: string,
	configHash: string,
): Promise<Result<number>> {
	// SPEC §4.3.2: gates judge the fail-closed local family (pre-tool:
	// secrets, reads, shell, confinement), which is sound on diff scopes.
	// The review-only hygiene rules (spec-trace, dead-code, history-entry)
	// need full-tree context the staged or pushed diff does not carry, so
	// they stay on the human `review` command until phase-5 finer triggers
	// let gates select rule subsets; a review trigger here blocked every
	// normally-commented file (BUG-0014).
	const evaluated = await evaluateScope(
		ports,
		packIds,
		{
			trigger: "pre-tool",
			files: [...files],
			note: hook,
			...(content === "" ? {} : { proposedContent: content }),
		},
		now,
		configHash,
	);
	if (!evaluated.ok) {
		return reportError(evaluated.error, req.json);
	}
	return emitGitVerdict(req, hook, evaluated.value);
}

// SPEC §4.7.1: L3 scans staged content. The staged file list scopes the
// disk reads while the staged diff rides as proposed content, so a secret
// staged but not yet matching the worktree still blocks.
async function runPreCommit(
	req: CommandRequest,
	ports: CommandPorts,
	packIds: ReadonlyArray<string>,
	now: string,
	configHash: string,
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
	return evaluateGitChange(
		ports,
		req,
		"pre-commit",
		packIds,
		staged.value,
		diff.value,
		now,
		configHash,
	);
}

async function runCommitMsg(
	req: CommandRequest,
	ports: CommandPorts,
	configHash: string,
): Promise<Result<number>> {
	if (req.args.length !== 2 || req.args[1] === undefined) {
		return usageError("usage: codictator git commit-msg <file>");
	}
	const file = req.args[1];
	const trailer = `Codictator-L3: ${configHash.slice(0, 12)}`;
	const read = await ports.fs.readText(file);
	if (!read.ok) {
		return reportError(read.error, req.json);
	}
	if (
		read.value.split("\n").some((line) => line.startsWith("Codictator-L3: "))
	) {
		return ok(0);
	}
	const base = read.value.endsWith("\n") ? read.value : `${read.value}\n`;
	const wrote = await ports.fs.write(file, encodeText(`${base}\n${trailer}\n`));
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
	const base = upstream.value.trim();
	const names = await runGitText(ports, [
		"git",
		"diff",
		"--name-only",
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
	return evaluateGitChange(
		ports,
		req,
		"pre-push",
		packIds,
		files,
		diff.value,
		now,
		configHash,
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
	const configured = await loadRepoConfig(root, hookEnv(commandEnv()));
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
	if (hook === "pre-push") {
		return runPrePush(req, ports, packIds, now, configHash);
	}
	return runPreCommit(req, ports, packIds, now, configHash);
}

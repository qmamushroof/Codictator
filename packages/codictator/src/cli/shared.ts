// SPEC §4.19: shared CLI plumbing. The command tables in commands.ts and
// the handlers beside it build on this: global flags, ports, output and
// the §8.2 exit mapping. Emits to stdout/stderr like runHook does; TAP
// parsers skip non-TAP lines, so test output stays parseable.

import { errorRowFor } from "../features/audit/index.ts";
import {
	type EffectiveConfig,
	loadConfig as loadConfigImpl,
	requireHuman,
} from "../features/config/index.ts";
import type { CdxError, Env, Ports, Result } from "../kernel/index.ts";
import {
	err,
	makeError,
	NodeEnv,
	NodeFs,
	NodeGit,
	NodeNet,
	NodeProc,
	ok,
	resolveRepoRoot,
	SystemClock,
	stableStringify,
} from "../kernel/index.ts";

// SPEC §2.3 with §4.19.4: the engine's node floor. The launcher enforces it
// before the engine starts; the CLI start path enforces it here, so a
// direct dist invocation fails the same way.
export const MIN_NODE_MAJOR = 24;

export interface CommandRequest {
	readonly args: ReadonlyArray<string>;
	readonly json: boolean;
	readonly quiet: boolean;
	readonly cwd: string;
	readonly nodeVersion: string | undefined;
	readonly stdinText: string | undefined;
}

export function nodeMajor(version: string): number {
	const match = /^v(\d+)\.[0-9]+\.[0-9]+/.exec(version);
	if (match === null) {
		return 0;
	}
	const major = Number.parseInt(match[1] ?? "0", 10);
	return Number.isSafeInteger(major) ? major : 0;
}

export function nodeTooOldMessage(version: string): string {
	return `CDX-E002 node ${version} is older than the required >=${MIN_NODE_MAJOR}.0.0.0; install a newer Node, then retry the tool call.`;
}

// SPEC §4.19.1: human output is terse; `--quiet` suppresses human lines
// (errors still land on stderr, `--json` output is unaffected).
export function printHuman(text: string, quiet: boolean): void {
	if (!quiet) {
		process.stdout.write(`${text}\n`);
	}
}

export function printJson(value: unknown): void {
	process.stdout.write(`${stableStringify(value)}\n`);
}

// SPEC §8.2: the exit for an error code; unknown codes are internal (7).
export function exitFor(code: string): number {
	return errorRowFor(code)?.exit ?? 7;
}

// Every error path prints before returning, so the built entry only maps
// the Result to its exit code. `--json` renders the error envelope.
export function reportError<T = number>(
	error: CdxError,
	json: boolean,
): Result<T> {
	if (json) {
		printJson({
			code: error.code,
			message: error.message,
			...(error.detail === undefined ? {} : { detail: error.detail }),
			remediation: error.remediation,
		});
	} else {
		process.stderr.write(`${error.code} ${error.message}\n`);
		process.stderr.write(`Do instead: ${error.remediation}\n`);
	}
	return err(error);
}

export function fail<T = number>(
	code: string,
	message: string,
	remediation: string,
	json: boolean,
	detail?: string,
): Result<T> {
	return reportError(makeError(code, message, remediation, detail), json);
}

// SPEC §4.19.6 EC-1: unknown command or flag is a usage error, not a
// CdxError row: usage line on stderr, exit 2.
export function usageError(text: string): Result<number> {
	process.stderr.write(`${text}\n`);
	return ok(2);
}

export function isTty(): boolean {
	return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

// SPEC §4.2.3: human-only commands refuse agents and non-TTYs with
// CDX-E107; requireHuman throws, so this narrows it to a Result.
export function checkHuman(
	env: Env,
	agentMarkers: ReadonlyArray<string>,
): Result<void> {
	try {
		requireHuman(env, isTty(), agentMarkers);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "string"
		) {
			const coded = error as CdxError;
			return err(coded);
		}
		return err(
			makeError(
				"CDX-E901",
				"human gate failed without a coded error",
				"Retry in an interactive terminal.",
			),
		);
	}
	return ok(undefined);
}

// Ports for command handlers: kernel-owned live ports; the Fs stays
// per-root and is created after the repo root resolves.
export function commandEnv(): Env {
	return new NodeEnv();
}

export interface CommandPorts extends Ports {
	readonly root: string;
}

export async function portsFor(root: string): Promise<Result<CommandPorts>> {
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return err(made.error);
	}
	const proc = new NodeProc();
	return ok({
		fs: made.value,
		proc,
		net: new NodeNet(),
		clock: new SystemClock(),
		git: new NodeGit(proc, root),
		env: commandEnv(),
		root,
	});
}

// CLI-owned state helpers. Command state (tasks, checkpoints, waivers,
// baselines, plans) lives in repo-relative JSON the owning module's
// validator approves; the CLI never invents a §7 format here.

export async function readStateText(
	root: string,
	rel: string,
): Promise<string | undefined> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return undefined;
	}
	const seen = await ports.value.fs.exists(rel);
	if (!seen.ok || !seen.value) {
		return undefined;
	}
	const text = await ports.value.fs.readText(rel);
	return text.ok ? text.value : undefined;
}

function encodeState(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

export async function needRoot(
	req: CommandRequest,
): Promise<string | Result<number>> {
	const root = await resolveRepoRoot(req.cwd);
	if (!root.ok) {
		return fail(
			"CDX-E703",
			root.error.message,
			root.error.remediation,
			req.json,
		);
	}
	return root.value;
}

export async function needTaskRoot(
	req: CommandRequest,
): Promise<string | Result<number>> {
	return needRoot(req);
}

export async function writeStateText(
	root: string,
	rel: string,
	text: string,
): Promise<Result<void>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	const done = await ports.value.fs.write(rel, encodeState(text));
	if (!done.ok) {
		return err(done.error);
	}
	return ok(undefined);
}

// SPEC §4.2.1 + §4.1.1: config loads through caller-owned ports against
// the logical root ".", so every audit path stays repo-relative and the
// confinement check never sees an absolute path (the hook runtime's own
// pattern). Throws become Results carrying their SPEC row.
export async function loadRepoConfig(
	root: string,
): Promise<Result<{ ports: CommandPorts; effective: EffectiveConfig }>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	try {
		const effective = await loadConfigImpl(".", ports.value);
		return ok({ ports: ports.value, effective });
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "string" &&
			"message" in error &&
			typeof error.message === "string" &&
			"remediation" in error &&
			typeof error.remediation === "string"
		) {
			const coded = error as {
				code: string;
				message: string;
				remediation: string;
				detail?: unknown;
			};
			return err({
				code: coded.code,
				message: coded.message,
				remediation: coded.remediation,
				...(typeof coded.detail === "string" ? { detail: coded.detail } : {}),
			});
		}
		const message =
			error instanceof Error ? error.message : "config unreadable";
		return err({
			code: "CDX-E101",
			message,
			remediation: "Fix .codictator/config.json, then retry.",
		});
	}
}

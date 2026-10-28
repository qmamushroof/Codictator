// SPEC §4.19: composition root. Commands, hook entry, server. May import
// everything (§3.3); owns no §7 format.

import type { HookAppend, HookBasePorts } from "../features/adapters/index.ts";
import {
	HOOK_PAYLOAD_MAX_BYTES,
	hookBudgetMs,
	runHookEvent,
	staticBlock,
	supportedHarness,
} from "../features/adapters/index.ts";
import { appendEvent, type NewEvent } from "../features/audit/index.ts";
import type { CdxError, Result } from "../kernel/index.ts";
import {
	NodeEnv,
	NodeFs,
	NodeGit,
	NodeNet,
	NodeProc,
	readStdinText,
	SystemClock,
} from "../kernel/index.ts";

export interface CliOptions {
	readonly argv: ReadonlyArray<string>;
	readonly cwd: string;
	// Test and embedder seam: when set, the hook entry evaluates this text
	// instead of reading process stdin. Production harness runs never set it.
	readonly stdinText?: string;
	// Test seam: overrides process.version for the Node floor check (§4.19.4),
	// so the old-node rejection stays verifiable on any runner, including
	// Node ≥24. Production callers never set it.
	readonly nodeVersion?: string;
}

// SPEC §2.3 with §4.19.4: the engine's node floor. The launcher enforces it
// before the engine starts; the CLI start path enforces it here, so a
// direct dist invocation fails the same way.
const MIN_NODE_MAJOR = 24;

function nodeMajor(version: string): number {
	const match = /^v(\d+)\.[0-9]+\.[0-9]+/.exec(version);
	if (match === null) {
		return 0;
	}
	const major = Number.parseInt(match[1] ?? "0", 10);
	return Number.isSafeInteger(major) ? major : 0;
}

function nodeTooOldMessage(version: string): string {
	return `CDX-E002 node ${version} is older than the required >=${MIN_NODE_MAJOR}.0.0; install a newer Node, then retry the tool call.`;
}

// SPEC §4.19.3 steps 3 and 5: the verdict line lands in the resolved repo's
// event log. An append failure is the engine's CDX-E801 path, never a throw
// here, so writer faults stay fail-closed without crashing the hook.
// SPEC §4.1.1: the Fs is already confined to root, so the logical root is
// "." and every audit path stays repo-relative.
async function appendLine(
	root: string,
	event: NewEvent,
	ports: HookBasePorts,
): Promise<Result<void>> {
	const fsMade = await NodeFs.create({ root });
	if (!fsMade.ok) {
		return fsMade;
	}
	return appendEvent(
		{
			fs: fsMade.value,
			proc: ports.proc,
			net: ports.net,
			clock: ports.clock,
			git: new NodeGit(ports.proc, root),
			env: ports.env,
		},
		".",
		event,
	);
}

function basePorts(): HookBasePorts {
	return {
		proc: new NodeProc(),
		net: new NodeNet(),
		clock: new SystemClock(),
		env: new NodeEnv(),
	};
}

function emitReply(stdout: string, stderr: string, exitCode: number): number {
	if (stdout !== "") {
		process.stdout.write(stdout);
	}
	if (stderr !== "") {
		process.stderr.write(stderr);
	}
	return exitCode;
}

// SPEC §4.19.3: hook runtime entry; an uncaught error becomes a block. The
// reply goes to stdout verbatim (the harness parses it; golden EC-14 pins
// stdout exactly), diagnostics to stderr, and the harness exit code returns.
// Nothing reads the disk before the runtime resolves the repo root, so
// unknown harnesses and empty payloads answer without I/O.
export async function runHook(options: CliOptions): Promise<number> {
	const harness = options.argv[1] ?? "";
	const event = options.argv[2] ?? "";
	const version = options.nodeVersion ?? process.version;
	if (nodeMajor(version) < MIN_NODE_MAJOR) {
		const staticReply =
			harness === ""
				? undefined
				: staticBlock(harness, "CDX-E002", nodeTooOldMessage(version));
		if (staticReply === undefined) {
			process.stderr.write(`${nodeTooOldMessage(version)}\n`);
			return 6;
		}
		return emitReply(
			staticReply.stdout,
			staticReply.stderr,
			staticReply.exitCode,
		);
	}
	const ports = basePorts();
	const append: HookAppend = (root, line) => appendLine(root, line, ports);
	if (!supportedHarness(harness)) {
		const reply = await runHookEvent({
			harness,
			event,
			stdinText: "",
			cwd: options.cwd,
			ports,
			append,
		});
		return emitReply(reply.stdout, reply.stderr, reply.exitCode);
	}
	let stdinText = options.stdinText;
	if (stdinText === undefined) {
		// The stdin wait shares the hook budget: an idle pipe fails closed
		// with CDX-E902 instead of hanging past the time limit (§4.5.5).
		const stdin = await readStdinText(
			HOOK_PAYLOAD_MAX_BYTES,
			hookBudgetMs(harness),
		);
		if (!stdin.ok) {
			const blocked = staticBlock(
				harness,
				stdin.error.code,
				stdin.error.message,
			);
			if (blocked === undefined) {
				process.stderr.write(`${stdin.error.code} ${stdin.error.message}\n`);
				return 1;
			}
			return emitReply(blocked.stdout, blocked.stderr, blocked.exitCode);
		}
		stdinText = stdin.value;
	}
	const reply = await runHookEvent({
		harness,
		event,
		stdinText,
		cwd: options.cwd,
		ports,
		append,
	});
	return emitReply(reply.stdout, reply.stderr, reply.exitCode);
}

// SPEC §4.19: command dispatch (init, regen, verify, task, review, ...).
export function runCommand(_options: CliOptions): Promise<Result<number>> {
	throw new Error("not implemented: SPEC §4.19");
}

// SPEC §7.15: stdio server entry for the vscode extension.
export function runServer(_options: CliOptions): Promise<number> {
	throw new Error("not implemented: SPEC §7.15");
}

export type { CdxError };

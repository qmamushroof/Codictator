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
	err,
	NodeEnv,
	NodeFs,
	NodeGit,
	NodeNet,
	NodeProc,
	ok,
	readStdinText,
	SystemClock,
} from "../kernel/index.ts";
import { COMMANDS, type Handler, USAGE } from "./commands.ts";
import { loadEvalEnforcers } from "./evaluate.ts";
import { startStdioServer } from "./serve-server.ts";
import {
	MIN_NODE_MAJOR,
	nodeMajor,
	nodeTooOldMessage,
	printHuman,
	usageError,
} from "./shared.ts";

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

// The old-node rejection: a static block when the harness has one,
// stderr plus exit 6 otherwise.
function oldNodeExit(harness: string, version: string): number {
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

// A failed stdin wait fails closed: a static block when the harness has
// one, stderr plus exit 1 otherwise.
function blockedStdinExit(
	harness: string,
	code: string,
	message: string,
): number {
	const blocked = staticBlock(harness, code, message);
	if (blocked === undefined) {
		process.stderr.write(`${code} ${message}\n`);
		return 1;
	}
	return emitReply(blocked.stdout, blocked.stderr, blocked.exitCode);
}

async function invokeHookEvent(
	harness: string,
	event: string,
	stdinText: string,
	cwd: string,
	ports: HookBasePorts,
	append: HookAppend,
): Promise<number> {
	const reply = await runHookEvent({
		harness,
		event,
		stdinText,
		cwd,
		ports,
		append,
		// SPEC §4.19.3 step 5: the hook evaluates the same pack enforcers
		// the verify path loads (core plus the configured builtin packs),
		// resolved against the runtime's root-confined ports.
		loadEnforcers: loadEvalEnforcers,
	});
	return emitReply(reply.stdout, reply.stderr, reply.exitCode);
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
		return oldNodeExit(harness, version);
	}
	const ports = basePorts();
	const append: HookAppend = (root, line) => appendLine(root, line, ports);
	if (!supportedHarness(harness)) {
		return invokeHookEvent(harness, event, "", options.cwd, ports, append);
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
			return blockedStdinExit(harness, stdin.error.code, stdin.error.message);
		}
		stdinText = stdin.value;
	}
	return invokeHookEvent(harness, event, stdinText, options.cwd, ports, append);
}

// The command table and usage live in commands.ts; dispatch below routes
// through it.
interface Globals {
	json: boolean;
	quiet: boolean;
	cwd: string;
	help: boolean;
	rest: Array<string>;
}

function scanGlobals(
	argv: ReadonlyArray<string>,
	cwd: string,
): Globals | undefined {
	let json = false;
	let quiet = false;
	let help = false;
	let override: string | undefined;
	const rest: Array<string> = [];
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index] ?? "";
		if (token === "--json") {
			json = true;
		} else if (token === "--quiet") {
			quiet = true;
		} else if (token === "--help" || token === "-h") {
			help = true;
		} else if (token === "--cwd") {
			const next = argv[index + 1];
			if (next === undefined) {
				return undefined;
			}
			override = next;
			index += 1;
		} else if (token.startsWith("--cwd=")) {
			override = token.slice("--cwd=".length);
		} else {
			rest.push(token);
		}
	}
	return { json, quiet, cwd: override ?? cwd, help, rest };
}

// SPEC §4.19 + §8.2: the command entry. The node floor fails as CDX-E002
// (exit 6); unknown commands or flags are usage errors (exit 2, no code).
async function runCommandImpl(options: {
	argv: ReadonlyArray<string>;
	cwd: string;
	nodeVersion?: string | undefined;
}): Promise<Result<number>> {
	const version = options.nodeVersion ?? process.version;
	if (nodeMajor(version) < MIN_NODE_MAJOR) {
		process.stderr.write(`${nodeTooOldMessage(version)}\n`);
		return err({
			code: "CDX-E002",
			message: nodeTooOldMessage(version),
			remediation: "Install a newer Node, then retry the tool call.",
		});
	}
	const globals = scanGlobals(options.argv, options.cwd);
	if (globals === undefined) {
		return usageError(USAGE);
	}
	if (globals.help) {
		printHuman(USAGE, globals.quiet);
		return ok(0);
	}
	if (globals.rest.length === 0) {
		return usageError(USAGE);
	}
	const [command, ...args] = globals.rest as [string, ...Array<string>];
	const handler = (COMMANDS as Readonly<Record<string, Handler | undefined>>)[
		command
	];
	if (handler === undefined) {
		return usageError(`${USAGE}\nunknown command "${command}"`);
	}
	return handler({
		args,
		json: globals.json,
		quiet: globals.quiet,
		cwd: globals.cwd,
		nodeVersion: options.nodeVersion,
		stdinText: undefined,
	});
}

// SPEC §4.19: command dispatch (init, regen, verify, task, review, ...).
// The hook word routes back through the hook runtime; every other word
// goes through the command table in commands.ts. The hook reply is already emitted
// by runHook, so its harness exit code passes through as the value.
export function runCommand(options: CliOptions): Promise<Result<number>> {
	if (options.argv[0] === "hook") {
		return runHook(options).then(
			(exitCode): Result<number> => ({ ok: true, value: exitCode }),
		);
	}
	return runCommandImpl(options);
}

// SPEC §7.15 + §4.19.5: stdio server entry for the vscode extension. The
// loop serves one NDJSON session on this process's stdio; commands run
// through the same table with per-call output capture (see serve-run.ts),
// so frames stay the only stdout bytes. A closed stdin (no piped client)
// exits 0 without serving.
export function runServer(options: CliOptions): Promise<number> {
	return startStdioServer(options, runCommand);
}

export type { CdxError };

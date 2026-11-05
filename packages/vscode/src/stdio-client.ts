// SPEC §4.20.1 Engine + §7.15: the stdio JSON-RPC client. One
// `node <root>/.codictator/bin/run.mjs serve --stdio` child per folder
// with a config; NDJSON frames arrive on stdout while diagnostics stay on
// stderr. activateExtension spawns one handle per folder through
// serversForFolders and routes engine requests through routeEngineRequests
// plus setEngineRequest, so this client is the production Engine row.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { EngineRequest } from "./engine-client.ts";
import { isRecord, numberFieldOf } from "./engine-client.ts";
import { enginePathFor, supportedProtocolMajor } from "./host-adapter.ts";
import { appendEngineChunk } from "./stdio-framing.ts";
import type { TimelineDisposable } from "./timeline.ts";

const initializeMethod = "initialize";

// A pending call never resolves with canned data: transport failure
// rejects every waiter instead (fail closed).
interface PendingCall {
	resolve(result: unknown): void;
	reject(reason: unknown): void;
}

export interface StdioEngineHandle {
	readonly folderPath: string;
	readonly ready: Promise<string>;
	readonly request: EngineRequest;
	onEventsAppended(listener: (folderPath: string) => void): TimelineDisposable;
	dispose(): void;
}

// The argv serversForFolders records per folder, minus the node command:
// spawn("node", engineArgvFor(folder)) runs the engine the Engine row names.
export function engineArgvFor(folderPath: string): ReadonlyArray<string> {
	return [enginePathFor(folderPath), "serve", "--stdio"];
}

// Mutable per-process state shared by the framing, send, transport and
// handshake helpers below. closed flips once so fail-closed rejection
// runs exactly once and no waiter hangs. log carries transport and
// handshake failures to the Codictator output channel; stderr stays
// ignored on the pipe, so the log port is its only record.
export interface EngineState {
	readonly folderPath: string;
	readonly child: ChildProcess;
	readonly stdin: ChildProcess["stdin"];
	readonly stdout: ChildProcess["stdout"];
	readonly pending: Map<number, PendingCall>;
	readonly appendedListeners: Set<(folderPath: string) => void>;
	readonly resolveReady: (version: string) => void;
	readonly rejectReady: (reason: unknown) => void;
	readonly log: (message: string) => void;
	nextId: number;
	closed: boolean;
	buffered: string;
}

function failEngine(state: EngineState, reason: unknown): void {
	if (state.closed) {
		return;
	}
	state.closed = true;
	for (const call of state.pending.values()) {
		call.reject(reason);
	}
	state.pending.clear();
	state.rejectReady(reason);
}

function sendEngineMessage(
	state: EngineState,
	method: string,
	params: unknown,
): Promise<unknown> {
	const input = state.stdin;
	if (state.closed || input === null) {
		return Promise.reject(new Error(`engine closed for ${state.folderPath}`));
	}
	const id = state.nextId;
	state.nextId += 1;
	const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
	return new Promise<unknown>((resolve, reject) => {
		state.pending.set(id, { reject, resolve });
		input.write(line, (error: unknown) => {
			if (error !== null && error !== undefined) {
				state.pending.delete(id);
				reject(error);
			}
		});
	});
}

function attachEngineTransport(state: EngineState): void {
	const stdout = state.stdout;
	const stdin = state.stdin;
	if (stdout === null || stdin === null) {
		state.log(`engine stdio unavailable for ${state.folderPath}`);
		failEngine(
			state,
			new Error(`engine stdio unavailable for ${state.folderPath}`),
		);
		return;
	}
	stdout.setEncoding("utf8");
	stdout.on("data", (chunk: unknown) => {
		if (typeof chunk === "string") {
			appendEngineChunk(state, chunk);
		}
	});
	const transportFailed = (cause: unknown): void => {
		if (!state.closed) {
			state.log(
				`engine transport failed for ${state.folderPath}: ${transportDetailOf(cause)}`,
			);
		}
		failEngine(
			state,
			cause instanceof Error
				? cause
				: new Error(`engine failed for ${state.folderPath}`),
		);
	};
	stdout.on("error", transportFailed);
	stdout.on("close", () => {
		transportFailed(new Error(`engine closed for ${state.folderPath}`));
	});
	stdin.on("error", transportFailed);
	state.child.on("error", transportFailed);
	state.child.on("close", () => {
		transportFailed(new Error(`engine closed for ${state.folderPath}`));
	});
}

// SPEC §4.20.2: the failure detail for the output channel.
function transportDetailOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

// The initialize handshake: capture the server protocolVersion before
// the first query so a mismatch stays inert instead of misreading rows.
// Every failure logs to the output channel through the state log port.
function runEngineHandshake(state: EngineState): void {
	sendEngineMessage(state, initializeMethod, {})
		.then((answer): void => {
			const version = isRecord(answer)
				? numberFieldOf(answer, "protocolVersion")
				: undefined;
			if (version === undefined) {
				state.log(
					`engine handshake failed for ${state.folderPath}: missing protocolVersion`,
				);
				failEngine(
					state,
					new Error(`engine handshake failed for ${state.folderPath}`),
				);
				return;
			}
			if (version !== supportedProtocolMajor) {
				state.log(
					`engine handshake failed for ${state.folderPath}: protocol ${version} unsupported`,
				);
				failEngine(state, new Error(`engine protocol ${version} unsupported`));
				return;
			}
			state.resolveReady(version.toString());
		})
		.catch((cause: unknown) => {
			state.log(
				`engine handshake failed for ${state.folderPath}: ${transportDetailOf(cause)}`,
			);
			failEngine(state, cause);
		});
}

function createEngineHandle(
	state: EngineState,
	ready: Promise<string>,
): StdioEngineHandle {
	const request: EngineRequest = (
		_folderPath: string,
		method: string,
		params: unknown,
	): Promise<unknown> =>
		ready.then(() => sendEngineMessage(state, method, params));
	function onEventsAppended(
		listener: (folderPath: string) => void,
	): TimelineDisposable {
		state.appendedListeners.add(listener);
		return {
			dispose: (): void => {
				state.appendedListeners.delete(listener);
			},
		};
	}
	function dispose(): void {
		failEngine(state, new Error(`engine disposed for ${state.folderPath}`));
		try {
			state.child.kill();
		} catch {
			// Already exited; fail above already rejected every caller.
		}
	}
	return {
		dispose,
		folderPath: state.folderPath,
		onEventsAppended,
		ready,
		request,
	};
}

export function spawnStdioEngine(
	folderPath: string,
	log?: (message: string) => void,
): StdioEngineHandle {
	const child: ChildProcess = spawn("node", [...engineArgvFor(folderPath)], {
		stdio: ["pipe", "pipe", "ignore"],
	});
	let resolveReady: (version: string) => void = () => undefined;
	let rejectReady: (reason: unknown) => void = () => undefined;
	const ready = new Promise<string>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	// The child can die before anyone awaits ready; without a handler that
	// rejection escapes the host. Awaiting ready later still sees it.
	ready.catch(() => undefined);
	const state: EngineState = {
		appendedListeners: new Set(),
		buffered: "",
		child,
		closed: false,
		folderPath,
		log: log ?? ((): void => undefined),
		nextId: 1,
		pending: new Map(),
		rejectReady,
		resolveReady,
		stdin: child.stdin,
		stdout: child.stdout,
	};
	attachEngineTransport(state);
	runEngineHandshake(state);
	return createEngineHandle(state, ready);
}

// One EngineRequest over many per-folder handles. An unknown folder
// rejects instead of answering canned data, so a misroute can never look
// healthy.
export function routeEngineRequests(
	handles: ReadonlyMap<string, StdioEngineHandle>,
): EngineRequest {
	return (
		folderPath: string,
		method: string,
		params: unknown,
	): Promise<unknown> => {
		const handle = handles.get(folderPath);
		if (handle === undefined) {
			return Promise.reject(new Error(`no engine for ${folderPath}`));
		}
		return handle.request(folderPath, method, params);
	};
}

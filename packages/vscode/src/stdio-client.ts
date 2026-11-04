// SPEC §4.20.1 Engine + §7.15: the stdio JSON-RPC client. One
// `node <root>/.codictator/bin/run.mjs serve --stdio` child per folder
// with a config; NDJSON frames arrive on stdout while diagnostics stay on
// stderr. activateExtension spawns one handle per folder through
// serversForFolders and routes engine requests through routeEngineRequests
// plus setEngineRequest, so this client is the production Engine row.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { EngineRequest } from "./engine-client.ts";
import {
	isRecord,
	numberFieldOf,
	parseJsonLine,
	stringFieldOf,
} from "./engine-client.ts";
import { enginePathFor, supportedProtocolMajor } from "./host-adapter.ts";
import type { TimelineDisposable } from "./timeline.ts";

const initializeMethod = "initialize";
const appendedMethod = "events/appended";

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

function errorMessageOf(message: Record<string, unknown>): string {
	const error = message["error"];
	if (!isRecord(error)) {
		return "engine error";
	}
	return stringFieldOf(error, "message") ?? "engine error";
}

// Mutable per-process state shared by the framing, send, transport and
// handshake helpers below. closed flips once so fail-closed rejection
// runs exactly once and no waiter hangs.
interface EngineState {
	readonly folderPath: string;
	readonly child: ChildProcess;
	readonly stdin: ChildProcess["stdin"];
	readonly stdout: ChildProcess["stdout"];
	readonly pending: Map<number, PendingCall>;
	readonly appendedListeners: Set<(folderPath: string) => void>;
	readonly resolveReady: (version: string) => void;
	readonly rejectReady: (reason: unknown) => void;
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

// A numbered reply settles its waiter; an events/appended notification
// fans out to the Timeline source. Anything else is dropped: dropping
// never settles a waiter, so the request stays pending until the server
// answers or the transport closes.
function onEngineLine(state: EngineState, line: string): void {
	if (line === "") {
		return;
	}
	const message = parseJsonLine(line);
	if (message === undefined) {
		return;
	}
	const id = message["id"];
	if (typeof id === "number") {
		const call = state.pending.get(id);
		if (call === undefined) {
			return;
		}
		state.pending.delete(id);
		if ("error" in message) {
			call.reject(new Error(errorMessageOf(message)));
			return;
		}
		call.resolve(message["result"]);
		return;
	}
	if (id === undefined && message["method"] === appendedMethod) {
		for (const listener of [...state.appendedListeners]) {
			listener(state.folderPath);
		}
	}
}

// NDJSON framing: stdout chunks split anywhere, so bytes accumulate in
// buffered until each newline arrives; diagnostics stay on stderr.
function appendEngineChunk(state: EngineState, chunk: string): void {
	state.buffered += chunk;
	let newline = state.buffered.indexOf("\n");
	while (newline >= 0) {
		const line = state.buffered.slice(0, newline).replace(/\r$/, "");
		state.buffered = state.buffered.slice(newline + 1);
		onEngineLine(state, line);
		newline = state.buffered.indexOf("\n");
	}
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
		failEngine(
			state,
			cause instanceof Error
				? cause
				: new Error(`engine failed for ${state.folderPath}`),
		);
	};
	stdout.on("error", transportFailed);
	stdout.on("close", () => {
		failEngine(state, new Error(`engine closed for ${state.folderPath}`));
	});
	stdin.on("error", transportFailed);
	state.child.on("error", transportFailed);
	state.child.on("close", () => {
		failEngine(state, new Error(`engine closed for ${state.folderPath}`));
	});
}

// The initialize handshake: capture the server protocolVersion before
// the first query so a mismatch stays inert instead of misreading rows.
function runEngineHandshake(state: EngineState): void {
	sendEngineMessage(state, initializeMethod, {})
		.then((answer): void => {
			const version = isRecord(answer)
				? numberFieldOf(answer, "protocolVersion")
				: undefined;
			if (version === undefined) {
				failEngine(
					state,
					new Error(`engine handshake failed for ${state.folderPath}`),
				);
				return;
			}
			if (version !== supportedProtocolMajor) {
				failEngine(state, new Error(`engine protocol ${version} unsupported`));
				return;
			}
			state.resolveReady(version.toString());
		})
		.catch((cause: unknown) => {
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

export function spawnStdioEngine(folderPath: string): StdioEngineHandle {
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

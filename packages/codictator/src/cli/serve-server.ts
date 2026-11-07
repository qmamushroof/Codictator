// SPEC §4.19.5 + §7.15 + §4.19.6 EC-9/EC-10: the stdio server loop. One
// persistent stdin reader splits NDJSON lines; every line is answered with
// exactly one frame on stdout (or none for notifications), and the server
// survives malformed input. Event state is per call — no module singletons
// — so two servers on one repo work and log appends stay line-atomic
// through the single-append audit path. The log is re-read through the Fs
// port around each request (no timers), and new lines push
// `events/appended` notifications.
import type { EventLogLine } from "../features/audit/index.ts";
import type { Result } from "../kernel/index.ts";
import type { CliOptions } from "./index.ts";
import { readLogEvents } from "./inspect.ts";
import { dispatchMethod } from "./serve-methods.ts";
import {
	decodeLine,
	errorFrame,
	invalidRequestFrame,
	notificationFrame,
	parseErrorFrame,
	type RpcId,
	successFrame,
} from "./serve-protocol.ts";
import { handleRun, type RunContext } from "./serve-run.ts";
import type {
	MethodContext,
	StdioServerStdout,
	StdioServerStreams,
} from "./serve-shared.ts";
import { openLinePump } from "./serve-transport.ts";

export type ServeExecute = (options: CliOptions) => Promise<Result<number>>;

interface ServerState {
	readonly root: string;
	readonly engineVersion?: string;
	readonly execute: ServeExecute;
	readonly io: StdioServerStreams;
	readonly seen: { count: number; started: boolean };
}

function writeFrame(stdout: StdioServerStdout, text: string): void {
	stdout.write(text);
}

function writeDiagnostic(stderr: StdioServerStdout, text: string): void {
	stderr.write(`${text}\n`);
}

// The Fs-port watcher: the baseline is set at startup with no notify; after
// each request new lines push one `events/appended` notification carrying
// the new event lines. A poll interval covers external appends between
// requests (rotation-aware: a shrunk count re-opens the baseline), and a
// 150 ms debounce coalesces bursts into one frame.
async function collectAppended(
	state: ServerState,
): Promise<Array<EventLogLine>> {
	const log = await readLogEvents(state.root);
	if (log === undefined) {
		state.seen.count = 0;
		state.seen.started = true;
		return [];
	}
	const total = log.events.length + log.corrupt;
	if (!state.seen.started) {
		state.seen.count = total;
		state.seen.started = true;
		return [];
	}
	if (total <= state.seen.count) {
		state.seen.count = total;
		return [];
	}
	const fresh: Array<EventLogLine> = log.events.slice(state.seen.count);
	state.seen.count = total;
	return fresh;
}

function pushAppended(
	state: ServerState,
	fresh: ReadonlyArray<EventLogLine>,
): void {
	if (fresh.length > 0) {
		writeFrame(
			state.io.stdout,
			notificationFrame("events/appended", { events: fresh }),
		);
	}
}

async function pollAppended(state: ServerState): Promise<void> {
	pushAppended(state, await collectAppended(state));
}

// Watch-state for the debounced interval push. Pending lines queue while
// the log bursts; one timer flushes them 150 ms after the first arrival.
interface AppendedWatch {
	readonly stop: () => void;
}

function startAppendedWatch(state: ServerState): AppendedWatch {
	const WATCH_POLL_MS = 1000;
	const APPEND_DEBOUNCE_MS = 150;
	let pending: Array<EventLogLine> = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const flush = (): void => {
		timer = undefined;
		const events = pending;
		pending = [];
		if (!stopped) {
			pushAppended(state, events);
		}
	};
	const poll = (): void => {
		void collectAppended(state)
			.then((fresh) => {
				if (stopped || fresh.length === 0) {
					return;
				}
				pending.push(...fresh);
				if (timer === undefined) {
					timer = setTimeout(flush, APPEND_DEBOUNCE_MS);
				}
			})
			.catch(() => undefined);
	};
	const interval = setInterval(poll, WATCH_POLL_MS);
	return {
		stop: (): void => {
			stopped = true;
			clearInterval(interval);
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			pending = [];
		},
	};
}

// One request answered with exactly one frame; a throw inside a method
// can never escape the loop (EC-9 survival).
async function answerRequest(
	id: RpcId,
	method: string,
	params: unknown,
	state: ServerState,
): Promise<void> {
	try {
		const runCtx: RunContext =
			state.engineVersion === undefined
				? { root: state.root, execute: state.execute }
				: {
						root: state.root,
						engineVersion: state.engineVersion,
						execute: state.execute,
					};
		const methodCtx: MethodContext =
			state.engineVersion === undefined
				? { root: state.root }
				: { root: state.root, engineVersion: state.engineVersion };
		const outcome =
			method === "run"
				? await handleRun(params, runCtx)
				: await dispatchMethod(method, params, methodCtx);
		writeFrame(
			state.io.stdout,
			outcome.ok
				? successFrame(id, outcome.value)
				: errorFrame(id, outcome.error),
		);
	} catch {
		writeFrame(
			state.io.stdout,
			errorFrame(id, {
				code: -32603,
				message: "Internal error: the method failed to complete",
			}),
		);
	}
}

async function handleLine(line: string, state: ServerState): Promise<void> {
	if (line.trim() === "") {
		return;
	}
	const decoded = decodeLine(line);
	if (decoded.kind === "syntax") {
		writeFrame(state.io.stdout, parseErrorFrame());
		return;
	}
	if (decoded.kind === "bad") {
		writeFrame(state.io.stdout, invalidRequestFrame(decoded.id));
		return;
	}
	if (decoded.kind === "notification") {
		return;
	}
	const { id, method, params } = decoded.request;
	await answerRequest(id, method, params, state);
	try {
		await pollAppended(state);
	} catch {
		// The watcher is best-effort: the request was already answered, and
		// a watcher failure must never break the loop (EC-9 survival).
	}
}

// SPEC §7.15: serve one NDJSON session on this process's stdio. The loop
// ends on stdin EOF (the client disconnected) or a stdin error; the exit
// is always 0 so harness tests observe a clean shutdown. A silent pipe
// past the first-byte grace is a harness call with no client: exit 0
// without serving, so `node --test` and coverage runs never hang.
export function startStdioServer(
	options: CliOptions,
	execute: ServeExecute,
	streams: StdioServerStreams = {
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: process.stderr,
	},
): Promise<number> {
	const argv = options.argv;
	if (argv[0] !== "serve" || argv[1] !== "--stdio" || argv.length !== 2) {
		writeDiagnostic(streams.stderr, "usage: codictator serve --stdio");
		return Promise.resolve(2);
	}
	const state: ServerState = {
		root: options.cwd,
		...(options.engineVersion === undefined
			? {}
			: { engineVersion: options.engineVersion }),
		execute,
		io: streams,
		seen: { count: 0, started: false },
	};
	if (streams.stdin.readableEnded || streams.stdin.readable !== true) {
		return Promise.resolve(0);
	}
	const watch = startAppendedWatch(state);
	return new Promise<number>((resolve) => {
		openLinePump(
			streams.stdin,
			pollAppended(state),
			(line) => handleLine(line, state),
			(code) => {
				watch.stop();
				resolve(code);
			},
		);
	});
}

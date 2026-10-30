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
import { handleRun } from "./serve-run.ts";
import type { StdioServerStdout, StdioServerStreams } from "./serve-shared.ts";
import { openLinePump } from "./serve-transport.ts";

export type ServeExecute = (options: CliOptions) => Promise<Result<number>>;

interface ServerState {
	readonly root: string;
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
// the new event lines.
async function pollAppended(state: ServerState): Promise<void> {
	const log = await readLogEvents(state.root);
	if (log === undefined) {
		return;
	}
	const total = log.events.length + log.corrupt;
	if (!state.seen.started) {
		state.seen.count = total;
		state.seen.started = true;
		return;
	}
	if (total <= state.seen.count) {
		state.seen.count = total;
		return;
	}
	const fresh: Array<EventLogLine> = log.events.slice(state.seen.count);
	state.seen.count = total;
	if (fresh.length > 0) {
		writeFrame(
			state.io.stdout,
			notificationFrame("events/appended", { events: fresh }),
		);
	}
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
		const outcome =
			method === "run"
				? await handleRun(params, {
						root: state.root,
						execute: state.execute,
					})
				: await dispatchMethod(method, params, {
						root: state.root,
					});
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
		execute,
		io: streams,
		seen: { count: 0, started: false },
	};
	if (streams.stdin.readableEnded || streams.stdin.readable !== true) {
		return Promise.resolve(0);
	}
	return new Promise<number>((resolve) => {
		openLinePump(
			streams.stdin,
			pollAppended(state),
			(line) => handleLine(line, state),
			resolve,
		);
	});
}

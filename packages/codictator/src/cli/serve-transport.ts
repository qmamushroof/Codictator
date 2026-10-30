// SPEC §4.19.5 + §7.15: the stdin line-pump transport for `serve --stdio`.
// One persistent stdin reader splits NDJSON lines and queues each line to
// the session handler in arrival order. The queue always continues with
// the next line, so one bad read can never stall the server behind it
// (EC-9 survival). Listeners are per pump, so two servers in one process
// never share handler state (EC-10).
import type { StdioServerStdin } from "./serve-shared.ts";

// How long a piped stdin may stay silent before the server concludes no
// piped client exists (a harness call with no input, like the red-proof
// tests) and exits 0. Spawned clients write `initialize` in milliseconds;
// a TTY waits indefinitely instead, since a human types at human pace.
const FIRST_BYTE_GRACE_MS = 1000;

interface LinePump {
	buffer: string;
	chain: Promise<void>;
	settled: boolean;
	clearGrace: (() => void) | undefined;
	boundData: ((chunk: Buffer | string) => void) | undefined;
	boundEnd: (() => void) | undefined;
	boundError: (() => void) | undefined;
	readonly stdin: StdioServerStdin;
	readonly handleLine: (line: string) => Promise<void>;
	readonly done: (code: number) => void;
}

function pumpFinish(pump: LinePump, code: number): void {
	if (pump.settled) {
		return;
	}
	pump.settled = true;
	const settle = (): void => {
		pumpCleanup(pump);
		pump.done(code);
	};
	pump.chain.then(settle, settle);
}

function pumpCleanup(pump: LinePump): void {
	pump.clearGrace?.();
	if (pump.boundData !== undefined) {
		pump.stdin.removeListener("data", pump.boundData);
	}
	if (pump.boundEnd !== undefined) {
		pump.stdin.removeListener("end", pump.boundEnd);
	}
	if (pump.boundError !== undefined) {
		pump.stdin.removeListener("error", pump.boundError);
	}
	pump.stdin.pause();
}

// Split complete lines off the buffer, feeding each to the queue; the
// remainder stays buffered for the next chunk.
function drainLines(buffer: string, feed: (line: string) => void): string {
	let rest = buffer;
	let at = rest.indexOf("\n");
	while (at !== -1) {
		feed(rest.slice(0, at));
		rest = rest.slice(at + 1);
		at = rest.indexOf("\n");
	}
	return rest;
}

function pumpOnData(pump: LinePump, chunk: Buffer | string): void {
	pump.clearGrace?.();
	pump.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
	pump.buffer = drainLines(pump.buffer, (line) => {
		chainLine(pump, line);
	});
}

function pumpOnEnd(pump: LinePump): void {
	pump.clearGrace?.();
	if (pump.buffer.trim() !== "") {
		const pending = pump.buffer;
		pump.buffer = "";
		chainLine(pump, pending);
	}
	pumpFinish(pump, 0);
}

// A rejected step must never silence later lines: the chain always
// continues with the next line.
function chainLine(pump: LinePump, line: string): void {
	const pending = line;
	const run = (): Promise<void> => pump.handleLine(pending);
	pump.chain = pump.chain.then(run, run);
}

// A silent pipe past the grace is a harness call with no client: the
// caller clears the timer on the first byte, end or error.
function armFirstByteGrace(
	stdin: StdioServerStdin,
	onSilent: () => void,
): (() => void) | undefined {
	if (stdin.isTTY === true) {
		return undefined;
	}
	const timer = setTimeout(onSilent, FIRST_BYTE_GRACE_MS);
	return () => {
		clearTimeout(timer);
	};
}

// The stdin subscription for one session: the initial read (usually the
// watcher baseline) runs first and may never reject, then every line is
// queued in order behind it.
export function openLinePump(
	stdin: StdioServerStdin,
	initial: Promise<void>,
	handleLine: (line: string) => Promise<void>,
	done: (code: number) => void,
): void {
	const pump: LinePump = {
		buffer: "",
		chain: initial.then(
			() => undefined,
			() => undefined,
		),
		settled: false,
		clearGrace: armFirstByteGrace(stdin, () => {
			pumpFinish(pump, 0);
		}),
		boundData: undefined,
		boundEnd: undefined,
		boundError: undefined,
		stdin,
		handleLine,
		done,
	};
	pump.boundData = (chunk: Buffer | string): void => {
		pumpOnData(pump, chunk);
	};
	pump.boundEnd = (): void => {
		pumpOnEnd(pump);
	};
	pump.boundError = (): void => {
		pump.clearGrace?.();
		pumpFinish(pump, 0);
	};
	if (pump.boundData !== undefined) {
		stdin.on("data", pump.boundData);
	}
	if (pump.boundEnd !== undefined) {
		stdin.on("end", pump.boundEnd);
	}
	if (pump.boundError !== undefined) {
		stdin.on("error", pump.boundError);
	}
	stdin.resume();
}

// SPEC §4.20.4: restart and reconnect behaviour for step 11.5. EC-2: a
// crashed server restarts with backoff (1 s, 5 s, 30 s); the views show
// "disconnected" meanwhile (the "disconnected" text lives in the view
// layer; this module owns the delay schedule). EC-3: the server restarts
// when package-lock.json or the tool lock changes under it; anything else
// leaves the server alone. EC-12: engine stderr streams into the output
// channel with the last 200 lines on a ring, so a crash leaves its reason
// behind. Watching and rescue stay port-driven (ReconnectHooks), so the
// activation module keeps owning spawn, routes and refresh subscriptions.
import type { EngineState, StdioEngineHandle } from "./stdio-client.ts";

// SPEC §4.20.4: restart and reconnect behaviour for step 11.5. EC-2: a
// crashed server restarts with backoff (1 s, 5 s, 30 s); the views show
// "disconnected" meanwhile (the "disconnected" text lives in the view
// layer; this module owns the delay schedule).
export function reconnectBackoffMs(): ReadonlyArray<number> {
	return [1000, 5000, 30000];
}

// Fake-timer seam: production waits on setTimeout, unit tests inject an
// immediate clock, so no test ever sleeps through the backoff.
export type DelayFn = (ms: number) => Promise<void>;

export function defaultDelay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// A later attempt waits longer; past the schedule the last entry pins.
export function reconnectDelayMs(attempt: number): number {
	const schedule = reconnectBackoffMs();
	const clamped = Math.min(Math.max(attempt, 0), schedule.length - 1);
	return schedule[clamped] ?? 30000;
}

// SPEC §4.20 EC-3: the server restarts when package-lock.json or the tool
// lock changes under it; anything else leaves the server alone. The tool
// install is `.codictator/tool/package.json` + `package-lock.json`
// (§4.19.2), so any changed path whose basename is `package-lock.json`
// covers both the root lock and the tool lock.
export function shouldRestartOnLockChange(changedPath: string): boolean {
	const normalized = changedPath.replace(/\\/g, "/");
	const base = normalized.split("/").pop() ?? "";
	return base === "package-lock.json";
}

// SPEC §4.20 EC-4: an untrusted workspace keeps the extension inactive behind
// the VS Code trust prompt. Mirrors `untrustedWorkspaceSupport()` in
// main.ts and `capabilities.untrustedWorkspaces.supported: false` in
// package.json (§4.20.1 Trust): the extension executes the repo engine, so
// it never activates untrusted.
export function isActiveInUntrustedWorkspace(): boolean {
	return false;
}

// SPEC §4.20 EC-6: Cursor rides the VS Code 1.105 base, so the extension
// uses no API newer than 1.105 (types pinned to 1.105.0). Matches
// `engines.vscode: ^1.105.0` in package.json.
export function apiFloorVersion(): string {
	return "1.105.0";
}

// The activation-owned ports rescue and restart run through: drop and
// dispose the failed handle, adopt a fresh spawn (stored, routed,
// subscribed and watched), and repopulate the views.
export interface ReconnectHooks {
	readonly delay: DelayFn;
	readonly log: (message: string) => void;
	readonly forget: (folderPath: string) => void;
	readonly readopt: (folderPath: string, attempt: number) => void;
	readonly repopulate: () => void;
}

// SPEC §4.20 EC-2: watch one handle for death. The first of a ready
// rejection (handshake failure) or an exit notification (post-handshake
// crash) triggers one rescue; dispose-triggered closes never do, because
// the handle reports exit only when it failed first.
export function watchHandle(
	handle: StdioEngineHandle,
	hooks: ReconnectHooks,
	attempt = 0,
): void {
	let rescuing = false;
	const trigger = (): void => {
		if (rescuing) {
			return;
		}
		rescuing = true;
		void rescueEngine(hooks, handle.folderPath, attempt);
	};
	handle.ready.catch(trigger);
	handle.onExit?.(trigger);
}

// SPEC §4.20 EC-2: rescue with backoff. The failed handle is forgotten
// after the wait, then readopted at the next attempt, so consecutive
// failures escalate 1 s, 5 s, 30 s before pinning at 30 s.
async function rescueEngine(
	hooks: ReconnectHooks,
	folderPath: string,
	attempt: number,
): Promise<void> {
	const wait = reconnectDelayMs(attempt);
	hooks.log(`engine for ${folderPath} failed, retrying in ${wait / 1000}s`);
	await hooks.delay(wait);
	hooks.forget(folderPath);
	hooks.readopt(folderPath, attempt + 1);
	hooks.repopulate();
}

// SPEC §4.20 EC-3: restart the engine for one folder at once on a lock
// change: the lock change is already the cause, so a wait adds nothing.
export function restartFolder(hooks: ReconnectHooks, folderPath: string): void {
	hooks.forget(folderPath);
	hooks.readopt(folderPath, 0);
	hooks.repopulate();
}

// SPEC §4.20 EC-12: engine stderr is surfaced. Every line streams into the
// output channel and the last 200 stay on the ring for the crash log.
// Pipe chunks split anywhere, so a trailing partial line rides a carry
// until its newline (or the stream end) instead of logging fragmented.
const stderrRingLines = 200;

function appendStderrLine(state: EngineState, line: string): void {
	const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (trimmed === "") {
		return;
	}
	state.stderrTape.push(trimmed);
	if (state.stderrTape.length > stderrRingLines) {
		state.stderrTape.shift();
	}
	state.log(`engine stderr for ${state.folderPath}: ${trimmed}`);
}

function appendStderrChunk(state: EngineState, text: string): string {
	const parts = text.split("\n");
	const carry = parts.pop() ?? "";
	for (const line of parts) {
		appendStderrLine(state, line);
	}
	return carry;
}

export function attachStderrTape(state: EngineState): void {
	const stderr = state.child.stderr;
	if (stderr === null) {
		return;
	}
	let carry = "";
	stderr.setEncoding("utf8");
	stderr.on("data", (chunk: unknown) => {
		if (typeof chunk === "string") {
			carry = appendStderrChunk(state, carry + chunk);
		}
	});
	stderr.on("end", () => {
		if (carry !== "") {
			appendStderrLine(state, carry);
			carry = "";
		}
	});
}

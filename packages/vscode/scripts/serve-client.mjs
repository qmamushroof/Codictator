// SPEC §4.20: the minimal JSON-RPC client behind the E2E gates. Both the
// fast smoke (plain node:test, no display) and the in-host suite speak to
// the fixture launcher through it: one persistent `serve --stdio` child,
// requests resolved by id, and server notifications (`events/appended`)
// fanned out to waiters so a push can be proved with no request in flight.
import { spawn } from "node:child_process";

const REQUEST_TIMEOUT_MS = 30_000;

// One well-formed event-log line for an external append: the reader only
// requires the §4.18.1 shape fields, and `review` is a real trigger, so the
// push path treats the probe exactly like an engine-written verdict.
export function probeEventLine(id, engineVersion) {
	const now = new Date().toISOString();
	return `${JSON.stringify({
		configHash: "e2e-probe",
		decision: "allow",
		durationMs: 0,
		id,
		kind: "verdict",
		layer: "L2",
		message: "e2e liveness probe",
		now,
		packs: { core: engineVersion },
		ruleIds: [],
		trigger: "review",
		ts: now,
		v: 1,
	})}\n`;
}

function rejectAll(outstanding, error) {
	for (const waiter of outstanding) {
		clearTimeout(waiter.timer);
		waiter.reject(error);
	}
	outstanding.clear();
}

function markClosed(state, error) {
	if (state.closed) {
		return;
	}
	state.closed = true;
	rejectAll(state.pending, error);
	rejectAll(state.waiters, error);
}

// Spawn the fixture launcher with the fixture folder as cwd, the same
// shape as the PR1 extension spawn, so the D1 gate holds: the engine must
// resolve the fixture folder as its root, not the host cwd.
function spawnServeChild(launcherPath, cwd) {
	return spawn("node", [launcherPath, "serve", "--stdio"], {
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function settleReply(pending, frame) {
	const waiter = pending.get(frame.id);
	if (waiter === undefined) {
		return;
	}
	pending.delete(frame.id);
	clearTimeout(waiter.timer);
	if (Object.hasOwn(frame, "error") && frame.error !== undefined) {
		waiter.reject(new Error(JSON.stringify(frame.error)));
	} else {
		waiter.resolve(frame.result);
	}
}

function fanOutNotification(waiters, frame) {
	for (const waiter of [...waiters]) {
		if (waiter.method === frame.method) {
			waiters.delete(waiter);
			clearTimeout(waiter.timer);
			waiter.resolve(frame.params);
		}
	}
}

function dispatchLine(pending, waiters, line) {
	let frame;
	try {
		frame = JSON.parse(line);
	} catch {
		return;
	}
	if (frame === null || typeof frame !== "object") {
		return;
	}
	if (Object.hasOwn(frame, "id")) {
		settleReply(pending, frame);
		return;
	}
	if (typeof frame.method === "string") {
		fanOutNotification(waiters, frame);
	}
}

function feedChunk(state, chunk) {
	state.buffered += String(chunk);
	let newline = state.buffered.indexOf("\n");
	while (newline >= 0) {
		const line = state.buffered.slice(0, newline);
		state.buffered = state.buffered.slice(newline + 1);
		if (line !== "") {
			dispatchLine(state.pending, state.waiters, line);
		}
		newline = state.buffered.indexOf("\n");
	}
}

function sendRequest(state, method, params, timeoutMs) {
	state.nextId += 1;
	const id = state.nextId;
	return new Promise((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			state.pending.delete(id);
			rejectPromise(new Error(`engine ${method} timed out`));
		}, timeoutMs);
		state.pending.set(id, {
			reject: rejectPromise,
			resolve: (value) => {
				resolvePromise(value);
			},
			timer,
		});
		state.child.stdin.write(
			`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`,
		);
	});
}

function awaitNotification(state, method, timeoutMs) {
	return new Promise((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			state.waiters.delete(waiter);
			rejectPromise(
				new Error(`no ${method} notification within ${timeoutMs} ms`),
			);
		}, timeoutMs);
		const waiter = {
			method,
			reject: rejectPromise,
			resolve: (value) => {
				resolvePromise(value);
			},
			timer,
		};
		state.waiters.add(waiter);
	});
}

function closeSession(state) {
	markClosed(state, new Error("serve session closed"));
	state.child.kill();
	return new Promise((resolve) => {
		const guard = setTimeout(() => {
			resolve();
		}, 5_000);
		state.child.on("exit", () => {
			clearTimeout(guard);
			resolve();
		});
	});
}

export function openServeSession(launcherPath, cwd) {
	const state = {
		buffered: "",
		child: spawnServeChild(launcherPath, cwd),
		closed: false,
		nextId: 0,
		pending: new Map(),
		waiters: new Set(),
	};
	state.child.on("error", (error) => {
		markClosed(state, error);
	});
	state.child.stdout.on("data", (chunk) => {
		feedChunk(state, chunk);
	});
	return {
		close() {
			return closeSession(state);
		},
		request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
			return sendRequest(state, method, params, timeoutMs);
		},
		waitNotification(method, timeoutMs) {
			return awaitNotification(state, method, timeoutMs);
		},
	};
}

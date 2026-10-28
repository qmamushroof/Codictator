// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.19.3 stdin branches (TTY empty, over-cap CDX-E305,
// double-settle guard, unreadable-stdin empty) by stubbing the process.stdin
// listener surface; the stubs are restored after each test and no real pipe
// or timer expiry is involved, so the tests stay deterministic.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readStdinText } from "../../../src/kernel/index.ts";

type Listener = (...args: Array<unknown>) => void;

interface StdinSurface {
	on(event: string, listener: Listener): unknown;
	removeListener(event: string, listener: Listener): unknown;
	pause(): unknown;
	resume(): unknown;
	isTTY: boolean | undefined;
}

function surface(): StdinSurface {
	return process.stdin as unknown as StdinSurface;
}

function installStub(tty: boolean): {
	emit(event: string, value?: unknown): void;
	listeners(event: string): Array<Listener>;
	restore(): void;
} {
	const target = surface();
	const saved = {
		on: target.on,
		removeListener: target.removeListener,
		pause: target.pause,
		resume: target.resume,
		isTTY: target.isTTY,
	};
	const handlers = new Map<string, Array<Listener>>();
	target.isTTY = tty;
	target.on = (event: string, listener: Listener): unknown => {
		const list = handlers.get(event) ?? [];
		list.push(listener);
		handlers.set(event, list);
		return target;
	};
	target.removeListener = (event: string, listener: Listener): unknown => {
		handlers.set(
			event,
			(handlers.get(event) ?? []).filter((entry) => entry !== listener),
		);
		return target;
	};
	target.pause = (): unknown => target;
	target.resume = (): unknown => target;
	return {
		emit(event: string, value?: unknown): void {
			for (const listener of [...(handlers.get(event) ?? [])]) {
				listener(value);
			}
		},
		listeners(event: string): Array<Listener> {
			return [...(handlers.get(event) ?? [])];
		},
		restore(): void {
			target.on = saved.on;
			target.removeListener = saved.removeListener;
			target.pause = saved.pause;
			target.resume = saved.resume;
			target.isTTY = saved.isTTY;
		},
	};
}

test("[§4.19.3] stdin answers empty on a TTY without waiting", async () => {
	const stub = installStub(true);
	try {
		const result = await readStdinText(16, 1000);
		assert.ok(result.ok);
		if (result.ok) {
			assert.equal(result.value, "");
		}
	} finally {
		stub.restore();
	}
});

test("[§4.19.3] stdin joins data chunks and settles once", async () => {
	const stub = installStub(false);
	try {
		const pending = readStdinText(1024, 5000);
		const enders = stub.listeners("end");
		stub.emit("data", Buffer.from("hi"));
		stub.emit("data", Buffer.from("!"));
		stub.emit("end");
		// The finish guard drops the late duplicate instead of resolving twice.
		for (const ender of enders) {
			ender();
		}
		const result = await pending;
		assert.ok(result.ok);
		if (result.ok) {
			assert.equal(result.value, "hi!");
		}
	} finally {
		stub.restore();
	}
});

test("[§4.19.3] stdin over the byte cap fails CDX-E305", async () => {
	const stub = installStub(false);
	try {
		const pending = readStdinText(2, 5000);
		stub.emit("data", Buffer.from("abcdef"));
		const result = await pending;
		assert.ok(!result.ok);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E305");
		}
	} finally {
		stub.restore();
	}
});

test("[§4.19.3] stdin errors answer empty for the caller mapping", async () => {
	const stub = installStub(false);
	try {
		const pending = readStdinText(1024, 5000);
		stub.emit("error", new Error("boom"));
		const result = await pending;
		assert.ok(result.ok);
		if (result.ok) {
			assert.equal(result.value, "");
		}
	} finally {
		stub.restore();
	}
});

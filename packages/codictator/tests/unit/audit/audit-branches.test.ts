import { strict as assert } from "node:assert";

import test from "node:test";

import {
	appendEvent,
	KEEP_ROTATED,
	LOG_REL,
	MAX_LOG_BYTES,
	type NewEvent,
} from "../../../src/features/audit/append.ts";

import type {
	CdxError,
	Fs,
	FsStat,
	Ports,
	Result,
} from "../../../src/kernel/index.ts";

import { err, makeError } from "../../../src/kernel/index.ts";

import type { FakeFs } from "../../support/fake-fs.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

const ROOT = "repo";

const LOG = `${ROOT}/${LOG_REL}`;

type MethodName =
	| "read"
	| "readText"
	| "write"
	| "append"
	| "stat"
	| "list"
	| "glob"
	| "exists"
	| "realpath"
	| "remove";

function injected(): CdxError {
	return makeError("CDX-E801", "injected failure", "retry");
}

// A delegating fake: every call reaches the in-memory FakeFs unless the test
// armed that method's nth call to fail, so mid-sequence failures (rotate
// read/write/remove, stat, append) are reachable deterministically.
class SelectiveFs implements Fs {
	private readonly inner: FakeFs;
	private readonly counts = new Map<MethodName, number>();
	private readonly failures = new Map<number, Map<MethodName, CdxError>>();

	constructor(inner: FakeFs) {
		this.inner = inner;
	}

	failAt(method: MethodName, call: number, error: CdxError): void {
		let byCall = this.failures.get(call);
		if (byCall === undefined) {
			byCall = new Map<MethodName, CdxError>();
			this.failures.set(call, byCall);
		}
		byCall.set(method, error);
	}

	private take(method: MethodName): CdxError | undefined {
		const at = (this.counts.get(method) ?? 0) + 1;
		this.counts.set(method, at);
		return this.failures.get(at)?.get(method);
	}

	read(path: string): Promise<Result<Uint8Array>> {
		const failure = this.take("read");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.read(path);
	}

	readText(path: string): Promise<Result<string>> {
		const failure = this.take("readText");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.readText(path);
	}

	write(path: string, content: Uint8Array): Promise<Result<void>> {
		const failure = this.take("write");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.write(path, content);
	}

	append(path: string, content: Uint8Array): Promise<Result<void>> {
		const failure = this.take("append");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.append(path, content);
	}

	stat(path: string): Promise<Result<FsStat>> {
		const failure = this.take("stat");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.stat(path);
	}

	list(dir: string): Promise<Result<Array<string>>> {
		const failure = this.take("list");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.list(dir);
	}

	glob(pattern: string, dir: string): Promise<Result<Array<string>>> {
		const failure = this.take("glob");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.glob(pattern, dir);
	}

	exists(path: string): Promise<Result<boolean>> {
		const failure = this.take("exists");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.exists(path);
	}

	realpath(path: string): Promise<Result<string>> {
		const failure = this.take("realpath");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.realpath(path);
	}

	remove(path: string): Promise<Result<void>> {
		const failure = this.take("remove");
		if (failure !== undefined) {
			return Promise.resolve(err(failure));
		}
		return this.inner.remove(path);
	}
}

function makeEvent(overrides: Partial<NewEvent> = {}): NewEvent {
	return {
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: ["core/no-secrets"],
		durationMs: 5,
		configHash: "abc",
		packs: {},
		...overrides,
	};
}

function portsWith(fs: SelectiveFs, bundle: { ports: Ports }): Ports {
	return { ...bundle.ports, fs };
}

test("[§4.18] append fails closed when exists fails", async () => {
	const bundle = createFakePorts();
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("exists", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] append fails closed when stat fails", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "line\n");
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("stat", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] append fails closed when the write fails", async () => {
	const bundle = createFakePorts();
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("append", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] rotate fails closed when the state listing fails", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("list", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] rotate fails closed when reading the log fails", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("read", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] rotate fails closed when writing the rotated file fails", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("write", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] rotate fails closed when removing the log fails", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("remove", 1, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] rotate fails closed when pruning the oldest file fails", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	for (let index = 1; index <= KEEP_ROTATED; index += 1) {
		bundle.fs.seedText(
			`${ROOT}/.codictator/state/events.${index}.jsonl`,
			`{"v":1,"n":${index}}\n`,
		);
	}
	const fs = new SelectiveFs(bundle.fs);
	fs.failAt("remove", 2, injected());
	const appended = await appendEvent(portsWith(fs, bundle), ROOT, makeEvent());
	assert.equal(appended.ok, false);
	if (!appended.ok) {
		assert.equal(appended.error.code, "CDX-E801");
	}
});

test("[§4.18] unparsable rotated names are ignored when numbering", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	bundle.fs.seedText(`${ROOT}/.codictator/state/notes.txt`, "keep\n");
	bundle.fs.seedText(`${ROOT}/.codictator/state/events.abc.jsonl`, "junk\n");
	bundle.fs.seedText(`${ROOT}/.codictator/state/events.7.jsonl`, "old\n");
	const appended = await appendEvent(bundle.ports, ROOT, makeEvent());
	assert.equal(appended.ok, true);
	const rotated = await bundle.fs.exists(
		`${ROOT}/.codictator/state/events.8.jsonl`,
	);
	assert.equal(rotated.ok, true);
	if (rotated.ok) {
		assert.equal(rotated.value, true);
	}
});

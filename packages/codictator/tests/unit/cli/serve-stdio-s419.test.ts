import { strict as assert } from "node:assert";

import { readFileSync } from "node:fs";

import path from "node:path";

import { PassThrough } from "node:stream";

import test from "node:test";

import { startStdioServer } from "../../../src/cli/serve-server.ts";

import {
	field,
	type StdioServerStreams,
} from "../../../src/cli/serve-shared.ts";

import { portsFor } from "../../../src/cli/shared.ts";

import {
	appendEvent,
	type NewEvent,
} from "../../../src/features/audit/index.ts";

import type { Result } from "../../../src/kernel/index.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

// The boot checks above never run a method body, so the rows below drive
// dispatchMethod, handleRun and the protocol codecs in-process on temp
// repos. They hold the §10.6 floors for the new serve files.

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

const MINIMAL_CONFIG = JSON.stringify({
	version: 1,
	codictator: "0.0.0",
	packs: [],
	harnesses: ["opencode"],
});

// SPEC §4.19.6 EC-9/EC-10: genuine live-loop coverage. Each server gets its
// own in-memory stdio pair (production passes the process triple), so two
// servers share one process the way two VS Code windows share one repo.
interface LiveServer {
	readonly stdin: PassThrough;
	readonly done: Promise<number>;
	output(): string;
}

function startLiveServer(root: string): LiveServer {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let text = "";
	stdout.on("data", (chunk: Buffer | string) => {
		text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
	});
	const execute = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	const streams: StdioServerStreams = { stdin, stdout, stderr };
	const done = startStdioServer(
		{ argv: ["serve", "--stdio"], cwd: root },
		execute,
		streams,
	);
	return { stdin, done, output: () => text };
}

// Frames arrive over a stream, so the test waits for complete lines (and
// the wanted ids) instead of assuming a write batch already landed.
async function readFrames(
	server: LiveServer,
	count: number,
	ids: ReadonlyArray<unknown> = [],
): Promise<Array<Record<string, unknown>>> {
	const deadline = Date.now() + 5000;
	for (;;) {
		const lines = server
			.output()
			.split("\n")
			.filter((line) => line !== "");
		if (lines.length >= count) {
			const frames = lines.map((line) => recordOf(JSON.parse(line) as unknown));
			if (
				ids.every((id) => frames.some((frame) => field(frame, "id") === id))
			) {
				return frames;
			}
		}
		assert.ok(Date.now() < deadline, "timed out waiting for server frames");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function frameWithId(
	frames: ReadonlyArray<Record<string, unknown>>,
	id: unknown,
): Record<string, unknown> {
	const found = frames.find((frame) => field(frame, "id") === id);
	assert.ok(found !== undefined, `missing frame with id ${String(id)}`);
	return found;
}

function liveEvent(message: string): NewEvent {
	return {
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: [],
		durationMs: 1,
		configHash: "abc",
		packs: {},
		message,
	};
}

function tailMessages(frame: Record<string, unknown>): Array<string> {
	const events = field(
		recordOf(field(frame, "result")),
		"events",
	) as Array<unknown>;
	return events
		.map((event) => String(field(recordOf(event), "message")))
		.sort();
}

test("[§4.19 EC-9] server answers parse error and survives", async () => {
	// SPEC §4.19.6 EC-9: a malformed line through a live loop answers a
	// parse error (-32700, id null) and the server answers the next request.
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const server = startLiveServer(repo.dir);
		server.stdin.write("{not json\n");
		server.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
		server.stdin.end();
		const frames = await readFrames(server, 2, [1]);
		const code = await server.done;
		assert.equal(code, 0);
		assert.equal(frames.length, 2);
		const first = recordOf(frames[0]);
		assert.equal(field(first, "id"), null);
		assert.equal(field(recordOf(field(first, "error")), "code"), -32700);
		assert.equal(
			field(
				recordOf(field(frameWithId(frames, 1), "result")),
				"protocolVersion",
			),
			1,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-10] concurrent servers keep appends atomic", async () => {
	// SPEC §4.19.6 EC-10: two live servers on one repo both answer while
	// interleaved appends land line-atomic; both tails report every event.
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const first = startLiveServer(repo.dir);
		const second = startLiveServer(repo.dir);
		first.stdin.write('{"jsonrpc":"2.0","id":"a1","method":"initialize"}\n');
		second.stdin.write('{"jsonrpc":"2.0","id":"b1","method":"initialize"}\n');
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			throw new Error("expected repo ports to resolve");
		}
		const pending: Array<Promise<Result<void>>> = [];
		for (let i = 0; i < 10; i += 1) {
			pending.push(appendEvent(ports.value, ".", liveEvent(`ec10-a-${i}`)));
			pending.push(appendEvent(ports.value, ".", liveEvent(`ec10-b-${i}`)));
		}
		const settled = await Promise.all(pending);
		for (const outcome of settled) {
			assert.equal(outcome.ok, true);
		}
		first.stdin.write(
			'{"jsonrpc":"2.0","id":"a2","method":"events/tail","params":{"limit":100}}\n',
		);
		second.stdin.write(
			'{"jsonrpc":"2.0","id":"b2","method":"events/tail","params":{"limit":100}}\n',
		);
		first.stdin.end();
		second.stdin.end();
		const firstFrames = await readFrames(first, 2, ["a1", "a2"]);
		const secondFrames = await readFrames(second, 2, ["b1", "b2"]);
		const [firstCode, secondCode] = await Promise.all([
			first.done,
			second.done,
		]);
		assert.equal(firstCode, 0);
		assert.equal(secondCode, 0);
		assert.equal(
			field(
				recordOf(field(frameWithId(firstFrames, "a1"), "result")),
				"protocolVersion",
			),
			1,
		);
		assert.equal(
			field(
				recordOf(field(frameWithId(secondFrames, "b1"), "result")),
				"protocolVersion",
			),
			1,
		);
		const expected: Array<string> = [];
		for (let i = 0; i < 10; i += 1) {
			expected.push(`ec10-a-${i}`, `ec10-b-${i}`);
		}
		expected.sort();
		assert.deepEqual(tailMessages(frameWithId(firstFrames, "a2")), expected);
		assert.deepEqual(tailMessages(frameWithId(secondFrames, "b2")), expected);
		const raw = readFileSync(
			path.join(repo.dir, ".codictator", "state", "events.jsonl"),
			"utf8",
		);
		const logged = raw.split("\n").filter((line) => line !== "");
		assert.equal(logged.length, 20);
		for (const line of logged) {
			JSON.parse(line);
		}
	} finally {
		repo.cleanup();
	}
});

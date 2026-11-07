// SPEC §7.15 + §4.19.5: the serve handshake and fail-closed framing.
// Each scenario drives a live loop over in-memory stdio: a matching
// initialize answers the shape, a version mismatch fails without touching
// server state, and malformed lines plus unknown methods answer their
// JSON-RPC errors while the loop keeps serving.
import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import test from "node:test";
import { startStdioServer } from "../../../src/cli/serve-server.ts";
import {
	field,
	type StdioServerStreams,
} from "../../../src/cli/serve-shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

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

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

function frameWithId(
	frames: ReadonlyArray<Record<string, unknown>>,
	id: unknown,
): Record<string, unknown> {
	const found = frames.find((frame) => field(frame, "id") === id);
	assert.ok(found !== undefined, `missing frame with id ${String(id)}`);
	return found;
}

async function readFrames(
	server: LiveServer,
	count: number,
	ids: ReadonlyArray<unknown> = [],
): Promise<Array<Record<string, unknown>>> {
	const deadline = Date.now() + 10000;
	for (;;) {
		const lines = server
			.output()
			.split("\n")
			.filter((line) => line !== "");
		if (
			lines.length >= count &&
			ids.every((id) =>
				lines.some((line) => line.includes(`"id":${JSON.stringify(id)}`)),
			)
		) {
			return lines.map((line) => recordOf(JSON.parse(line) as unknown));
		}
		assert.ok(Date.now() < deadline, "timed out waiting for server frames");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

const MINIMAL_CONFIG = JSON.stringify({
	version: 1,
	codictator: "unknown",
	packs: [],
	harnesses: ["opencode"],
});

function requestLine(id: unknown, method: string, params?: unknown): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`;
}

test("[§7.15] initialize match answers the shape and status round-trips", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const server = startLiveServer(repo.dir);
		server.stdin.write(requestLine(1, "initialize", {}));
		server.stdin.write(requestLine(2, "status"));
		server.stdin.end();
		const frames = await readFrames(server, 2, [1, 2]);
		assert.equal(await server.done, 0);
		const first = recordOf(field(frameWithId(frames, 1), "result"));
		assert.equal(field(first, "protocolVersion"), 1);
		assert.equal(typeof field(first, "engineVersion"), "string");
		assert.equal(typeof field(first, "root"), "string");
		const second = recordOf(field(frameWithId(frames, 2), "result"));
		assert.equal(typeof field(second, "engineVersion"), "string");
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] initialize mismatch fails closed and stays inert", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const server = startLiveServer(repo.dir);
		server.stdin.write(requestLine(1, "initialize", { protocolVersion: 999 }));
		server.stdin.write(requestLine(2, "initialize", {}));
		server.stdin.end();
		const frames = await readFrames(server, 2, [1, 2]);
		assert.equal(await server.done, 0);
		const mismatch = recordOf(field(frameWithId(frames, 1), "error"));
		assert.equal(field(mismatch, "code"), -32602);
		const retry = recordOf(field(frameWithId(frames, 2), "result"));
		assert.equal(field(retry, "protocolVersion"), 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-9] malformed line answers a parse error and the loop survives", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const server = startLiveServer(repo.dir);
		server.stdin.write("{oops not json\n");
		server.stdin.write(requestLine(1, "initialize", {}));
		server.stdin.end();
		const frames = await readFrames(server, 2, [1]);
		assert.equal(await server.done, 0);
		assert.equal(frames.length, 2);
		const dropped = recordOf(frames[0]);
		assert.equal(field(dropped, "id"), null);
		assert.equal(field(recordOf(field(dropped, "error")), "code"), -32700);
		const retry = recordOf(field(frameWithId(frames, 1), "result"));
		assert.equal(field(retry, "protocolVersion"), 1);
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] unknown method answers method-not-found and the loop survives", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const server = startLiveServer(repo.dir);
		server.stdin.write(requestLine(7, "nope/missing"));
		server.stdin.write(requestLine(8, "initialize", {}));
		server.stdin.end();
		const frames = await readFrames(server, 2, [7, 8]);
		assert.equal(await server.done, 0);
		const unknown = recordOf(field(frameWithId(frames, 7), "error"));
		assert.equal(field(unknown, "code"), -32601);
		assert.ok(String(field(unknown, "message")).includes("nope/missing"));
		const retry = recordOf(field(frameWithId(frames, 8), "result"));
		assert.equal(field(retry, "protocolVersion"), 1);
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] run of a transport word fails closed", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const server = startLiveServer(repo.dir);
		server.stdin.write(requestLine(1, "run", { argv: ["serve", "--stdio"] }));
		server.stdin.write(requestLine(2, "run", { argv: ["hook", "x", "y"] }));
		server.stdin.end();
		const frames = await readFrames(server, 2, [1, 2]);
		assert.equal(await server.done, 0);
		for (const id of [1, 2]) {
			const refused = recordOf(field(frameWithId(frames, id), "error"));
			assert.equal(field(refused, "code"), -32602);
		}
	} finally {
		repo.cleanup();
	}
});

// SPEC §7.15 + BUG-0054: the serve watcher pushes `events/appended`
// without a request and answers `ping`. The server watches the event log
// (rotation-aware: re-open on size shrink) and pushes new lines debounced
// at 150 ms; before the fix, `events/appended` only left after a request
// and `ping` answered method-not-found, so the Timeline never updated live.
import { strict as assert } from "node:assert";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { dispatchMethod } from "../../../src/cli/serve-methods.ts";
import { startStdioServer } from "../../../src/cli/serve-server.ts";
import {
	field,
	type StdioServerStreams,
} from "../../../src/cli/serve-shared.ts";
import { ENGINE_VERSION } from "../../../src/features/config/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

const MINIMAL_CONFIG = JSON.stringify({
	version: 1,
	codictator: ENGINE_VERSION,
	packs: [],
	harnesses: ["opencode"],
});

function requestLine(id: unknown, method: string, params?: unknown): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`;
}

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

test("[§7.15] ping answers pong without touching server state", async () => {
	const outcome = await dispatchMethod("ping", undefined, { root: "/repo" });
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		assert.equal(field(recordOf(outcome.value), "pong"), true);
	}
});

test("[§7.15] events/appended push arrives after an external append without a request", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
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
			{ argv: ["serve", "--stdio"], cwd: repo.dir },
			execute,
			streams,
		);
		stdin.write(requestLine(1, "initialize", {}));
		const seenInit = async (): Promise<void> => {
			const deadline = Date.now() + 10000;
			for (;;) {
				if (text.split("\n").some((line) => line.includes('"id":1'))) {
					return;
				}
				assert.ok(Date.now() < deadline, "timed out waiting for initialize");
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		};
		await seenInit();
		mkdirSync(path.join(repo.dir, ".codictator", "state"), {
			recursive: true,
		});
		appendFileSync(
			path.join(repo.dir, ".codictator", "state", "events.jsonl"),
			'{"v":1,"id":"live-probe","kind":"verdict","layer":"L3","trigger":"review","ruleIds":[],"decision":"allow","durationMs":0,"configHash":"x","packs":{}}\n',
			"utf8",
		);
		const seenPush = async (): Promise<Record<string, unknown>> => {
			const deadline = Date.now() + 10000;
			for (;;) {
				const line = text
					.split("\n")
					.filter((candidate) => candidate !== "")
					.map((candidate) => recordOf(JSON.parse(candidate) as unknown))
					.find((frame) => field(frame, "method") === "events/appended");
				if (line !== undefined) {
					return line;
				}
				assert.ok(Date.now() < deadline, "timed out waiting for the push");
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		};
		const pushed = await seenPush();
		const params = recordOf(field(pushed, "params"));
		const events = field(params, "events");
		assert.ok(Array.isArray(events));
		assert.ok(events.length > 0);
		stdin.end();
		assert.equal(await done, 0);
	} finally {
		repo.cleanup();
	}
});

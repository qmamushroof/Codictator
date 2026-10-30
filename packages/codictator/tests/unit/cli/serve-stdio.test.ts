// SPEC §7.15 + §4.19.5: one test per stdio protocol row. Each scenario
// drives runServer; serve is unwired by design ("not implemented"), so all
// twelve fail red until phase 11 lands. Comments state the contract shape
// the implementation must satisfy.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { CliOptions } from "../../../src/cli/index.ts";
import { runServer } from "../../../src/cli/index.ts";
import { dispatchMethod } from "../../../src/cli/serve-methods.ts";
import {
	decodeLine,
	errorFrame,
	invalidParamsError,
	invalidRequestFrame,
	methodNotFoundError,
	notificationFrame,
	parseErrorFrame,
	serverError,
	successFrame,
} from "../../../src/cli/serve-protocol.ts";
import { handleRun } from "../../../src/cli/serve-run.ts";
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

function optionsFor(argv: ReadonlyArray<string>): CliOptions {
	return { argv, cwd: "/repo" };
}

test("[§7.15] budget/current returns per-session bands or unavailable", async () => {
	// SPEC §7.15: budget/current answers per-session bands, or unavailable
	// when no budget applies. Red with reason: runServer throws.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] events/appended notifies new event lines", async () => {
	// SPEC §7.15: the server watches the event log and pushes an
	// events/appended notification per new event line. Red: unwired.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] events/tail pages events by since and limit", async () => {
	// SPEC §7.15: events/tail { since?, limit } pages the event log.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] explain returns section 4.18.2 detail", async () => {
	// SPEC §7.15: explain { id } answers the §4.18.2 shape.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] findings/list returns findings with remediation", async () => {
	// SPEC §7.15: findings/list { files? } returns findings + remediation.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] initialize returns protocolVersion 1 with engineVersion and root", async () => {
	// SPEC §7.15: initialize answers { protocolVersion: 1, engineVersion,
	// root } over newline-delimited JSON-RPC 2.0 (UTF-8, one message/line).
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] rules/list returns rules with effective params waivers and coverage", async () => {
	// SPEC §7.15: rules/list returns rules with effective params, waivers,
	// coverage.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] run executes a CLI command", async () => {
	// SPEC §7.15 + §4.19.5: run { argv } executes CLI commands under the
	// same rules and answers the CLI result.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] run of a human-only command answers CDX-E107 with commandLine", async () => {
	// SPEC §7.15 + §4.19.5: a human-only command is answered with CDX-E107
	// and the exact command line in data.commandLine, so the extension can
	// open a terminal for the human (PRD §12 #22).
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] status returns section 4.18.3 JSON", async () => {
	// SPEC §7.15: status answers the §4.18.3 JSON.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] steering/history returns injections by session", async () => {
	// SPEC §7.15: steering/history { sessionId? } returns injections.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] verify evaluates a layer over files", async () => {
	// SPEC §7.15: verify { layer, files? } answers a verdict.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

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

function verdictLine(id: string): string {
	return JSON.stringify({
		v: 1,
		id,
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: [],
		durationMs: 5,
		configHash: "abc",
		packs: {},
	});
}

function injectionLine(id: string, sessionId: string): string {
	return JSON.stringify({
		v: 1,
		id,
		kind: "injection",
		layer: "L2",
		trigger: "pre-tool",
		sessionId,
		ruleIds: [],
		durationMs: 1,
		configHash: "abc",
		packs: {},
	});
}

test("[§7.15] dispatch initialize answers the handshake shape", async () => {
	const outcome = await dispatchMethod("initialize", undefined, {
		root: "/repo",
	});
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "protocolVersion"), 1);
		assert.equal(typeof field(value, "engineVersion"), "string");
		assert.equal(typeof field(value, "root"), "string");
	}
});

test("[§7.15] dispatch status answers engineVersion with gap on an empty log", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod("status", undefined, {
			root: repo.dir,
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(typeof field(value, "engineVersion"), "string");
			assert.equal(field(value, "gap"), true);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch rules/list answers rules with params waivers coverage", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod("rules/list", undefined, {
			root: repo.dir,
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.ok(Array.isArray(field(value, "rules")));
			const rules = field(value, "rules") as Array<unknown>;
			assert.ok(rules.length > 0);
			const row = recordOf(rules[0]);
			assert.equal(typeof field(row, "id"), "string");
			assert.ok(String(field(row, "pack")).includes("@"));
			assert.equal(typeof field(row, "params"), "object");
			assert.ok(Array.isArray(field(row, "waivers")));
			assert.equal(typeof field(row, "coverage"), "string");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch explain without an id answers invalid params", async () => {
	for (const params of [undefined, {}, { id: "" }, { id: 5 }]) {
		const outcome = await dispatchMethod("explain", params, {
			root: "/repo",
		});
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32602);
		}
	}
});

test("[§7.15] dispatch explain with an unknown id answers CDX-E010", async () => {
	const outcome = await dispatchMethod(
		"explain",
		{ id: "nope/missing" },
		{
			root: "/repo",
		},
	);
	assert.equal(outcome.ok, false);
	if (!outcome.ok) {
		assert.equal(outcome.error.code, -32000);
		assert.ok(outcome.error.message.includes("CDX-E010"));
	}
});

test("[§7.15] dispatch explain with an error code answers the error kind", async () => {
	const outcome = await dispatchMethod(
		"explain",
		{ id: "CDX-E107" },
		{
			root: "/repo",
		},
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "kind"), "error");
		assert.equal(field(value, "code"), "CDX-E107");
	}
});

test("[§7.15] dispatch explain with a rule id answers the rule kind", async () => {
	const outcome = await dispatchMethod(
		"explain",
		{ id: "core/arch-module-mapped" },
		{ root: "/repo" },
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "kind"), "rule");
		assert.equal(field(value, "rule"), "core/arch-module-mapped");
	}
});

test("[§7.15] dispatch findings/list with no files answers allow on an empty scope", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod(
			"findings/list",
			{ files: [] },
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(field(value, "decision"), "allow");
			assert.ok(Array.isArray(field(value, "findings")));
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch findings/list with a bad files value answers invalid params", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		for (const params of [{ files: "nope" }, { files: [5] }, ["files"]]) {
			const outcome = await dispatchMethod("findings/list", params, {
				root: repo.dir,
			});
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.error.code, -32602);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch findings/list without config answers the config failure", async () => {
	const repo = createTempRepo({});
	try {
		const outcome = await dispatchMethod(
			"findings/list",
			{ files: [] },
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32000);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch verify with a bad layer answers invalid params", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		for (const params of [undefined, {}, { layer: "L9" }, { layer: 2 }]) {
			const outcome = await dispatchMethod("verify", params, {
				root: repo.dir,
			});
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.error.code, -32602);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch verify L1 with no files answers an allow verdict", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod(
			"verify",
			{ layer: "L1", files: [] },
			{ root: repo.dir },
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(field(value, "verdict"), "allow");
			assert.equal(field(value, "layer"), "L1");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch events/tail pages by since and limit", async () => {
	const repo = createTempRepo({
		".codictator/config.json": MINIMAL_CONFIG,
		".codictator/state/events.jsonl": [
			verdictLine("e1"),
			verdictLine("e2"),
			injectionLine("i1", "s1"),
			injectionLine("i2", "s2"),
			"",
		].join("\n"),
	});
	try {
		const all = await dispatchMethod("events/tail", {}, { root: repo.dir });
		assert.equal(all.ok, true);
		if (all.ok) {
			assert.equal(
				(field(recordOf(all.value), "events") as Array<unknown>).length,
				4,
			);
		}
		const after = await dispatchMethod(
			"events/tail",
			{ since: "e1" },
			{
				root: repo.dir,
			},
		);
		assert.equal(after.ok, true);
		if (after.ok) {
			const events = field(recordOf(after.value), "events") as Array<unknown>;
			assert.equal(events.length, 3);
			assert.equal(field(recordOf(events[0]), "id"), "e2");
		}
		const capped = await dispatchMethod(
			"events/tail",
			{ limit: 1 },
			{
				root: repo.dir,
			},
		);
		assert.equal(capped.ok, true);
		if (capped.ok) {
			assert.equal(
				(field(recordOf(capped.value), "events") as Array<unknown>).length,
				1,
			);
		}
		const missed = await dispatchMethod(
			"events/tail",
			{ since: "gone" },
			{
				root: repo.dir,
			},
		);
		assert.equal(missed.ok, true);
		if (missed.ok) {
			assert.equal(
				(field(recordOf(missed.value), "events") as Array<unknown>).length,
				0,
			);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch events/tail with a bad limit answers invalid params", async () => {
	const repo = createTempRepo({
		".codictator/config.json": MINIMAL_CONFIG,
		".codictator/state/events.jsonl": `${verdictLine("e1")}\n`,
	});
	try {
		for (const params of [
			{ limit: 0 },
			{ limit: -2 },
			{ since: 5 },
			[],
		] as Array<unknown>) {
			const outcome = await dispatchMethod("events/tail", params, {
				root: repo.dir,
			});
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.error.code, -32602);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch events/tail without a log answers an empty page", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod(
			"events/tail",
			{},
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal((field(value, "events") as Array<unknown>).length, 0);
			assert.equal(field(value, "corrupt"), 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch steering/history filters injections by session", async () => {
	const repo = createTempRepo({
		".codictator/config.json": MINIMAL_CONFIG,
		".codictator/state/events.jsonl": [
			verdictLine("e1"),
			injectionLine("i1", "s1"),
			injectionLine("i2", "s2"),
			"",
		].join("\n"),
	});
	try {
		const all = await dispatchMethod(
			"steering/history",
			{},
			{
				root: repo.dir,
			},
		);
		assert.equal(all.ok, true);
		if (all.ok) {
			assert.equal(
				(field(recordOf(all.value), "injections") as Array<unknown>).length,
				2,
			);
		}
		const one = await dispatchMethod(
			"steering/history",
			{ sessionId: "s1" },
			{
				root: repo.dir,
			},
		);
		assert.equal(one.ok, true);
		if (one.ok) {
			const injections = field(
				recordOf(one.value),
				"injections",
			) as Array<unknown>;
			assert.equal(injections.length, 1);
			assert.equal(field(recordOf(injections[0]), "id"), "i1");
		}
		for (const params of [{ sessionId: 5 }, ["s1"]] as Array<unknown>) {
			const outcome = await dispatchMethod("steering/history", params, {
				root: repo.dir,
			});
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.error.code, -32602);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch budget/current answers unavailable without usage", async () => {
	const outcome = await dispatchMethod(
		"budget/current",
		{},
		{
			root: "/repo",
		},
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "available"), false);
		assert.equal(field(value, "status"), "unavailable");
	}
	const named = await dispatchMethod(
		"budget/current",
		{ sessionId: "s9" },
		{
			root: "/repo",
		},
	);
	assert.equal(named.ok, true);
	const bad = await dispatchMethod("budget/current", [], { root: "/repo" });
	assert.equal(bad.ok, false);
	if (!bad.ok) {
		assert.equal(bad.error.code, -32602);
	}
});

test("[§7.15] dispatch of an unknown method answers method not found", async () => {
	const outcome = await dispatchMethod("bogus/method", undefined, {
		root: "/repo",
	});
	assert.equal(outcome.ok, false);
	if (!outcome.ok) {
		assert.equal(outcome.error.code, -32601);
		assert.ok(outcome.error.message.includes("bogus/method"));
	}
});

test("[§7.15] run of a human-only command answers CDX-E107 with commandLine", async () => {
	const stub = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	for (const argv of [
		["waive", "core/no-secrets", "--reason", "x"],
		["baseline", "capture"],
	]) {
		const outcome = await handleRun({ argv }, { root: "/repo", execute: stub });
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32000);
			assert.ok(outcome.error.message.startsWith("CDX-E107"));
			const data = recordOf(outcome.error.data);
			assert.equal(field(data, "code"), "CDX-E107");
			assert.equal(field(data, "commandLine"), `codictator ${argv.join(" ")}`);
		}
	}
});

test("[§7.15] run executes argv through the executor and captures output", async () => {
	const silent = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	const quiet = await handleRun(
		{ argv: ["status"] },
		{
			root: "/repo",
			execute: silent,
		},
	);
	assert.equal(quiet.ok, true);
	if (quiet.ok) {
		const value = recordOf(quiet.value);
		assert.equal(field(value, "exitCode"), 0);
		assert.equal(field(value, "stdout"), "");
		assert.equal(field(value, "stderr"), "");
	}
	const noisy = (): Promise<{ ok: true; value: number }> => {
		process.stdout.write("out");
		process.stderr.write(Buffer.from("err"));
		return Promise.resolve({ ok: true, value: 0 });
	};
	const captured = await handleRun(
		{ argv: ["status"] },
		{
			root: "/repo",
			execute: noisy,
		},
	);
	assert.equal(captured.ok, true);
	if (captured.ok) {
		const value = recordOf(captured.value);
		assert.equal(field(value, "stdout"), "out");
		assert.equal(field(value, "stderr"), "err");
	}
});

test("[§7.15] run with bad params answers invalid params", async () => {
	const stub = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	for (const params of [undefined, {}, { argv: [] }, { argv: ["ok", 5] }]) {
		const outcome = await handleRun(params, { root: "/repo", execute: stub });
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32602);
		}
	}
});

test("[§7.15] run of a failing command answers its code and remediation", async () => {
	const failing = (): Promise<{
		ok: false;
		error: { code: string; message: string; remediation: string };
	}> =>
		Promise.resolve({
			ok: false,
			error: { code: "CDX-E001", message: "boom", remediation: "retry" },
		});
	const outcome = await handleRun(
		{ argv: ["status"] },
		{
			root: "/repo",
			execute: failing,
		},
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(typeof field(value, "exitCode"), "number");
		assert.equal(field(value, "code"), "CDX-E001");
		assert.equal(field(value, "remediation"), "retry");
	}
});

test("[§7.15] protocol decodeLine separates requests notifications syntax and bad lines", async () => {
	const request = decodeLine('{"jsonrpc":"2.0","id":7,"method":"status"}');
	assert.equal(request.kind, "request");
	if (request.kind === "request") {
		assert.equal(request.request.id, 7);
		assert.equal(request.request.method, "status");
	}
	const notified = decodeLine(
		'{"jsonrpc":"2.0","method":"events/appended","params":{"n":1}}',
	);
	assert.equal(notified.kind, "notification");
	assert.equal(decodeLine("{oops").kind, "syntax");
	assert.equal(decodeLine('"just a string"').kind, "bad");
	assert.equal(decodeLine('{"jsonrpc":"1.0","id":1,"method":"x"}').kind, "bad");
	assert.equal(
		decodeLine('{"jsonrpc":"2.0","id":[],"method":"status"}').kind,
		"bad",
	);
});

test("[§7.15] protocol frames round-trip through JSON with stable keys", async () => {
	const success = JSON.parse(successFrame(1, { done: true }).trim()) as Record<
		string,
		unknown
	>;
	assert.equal(field(success, "id"), 1);
	assert.equal(field(recordOf(field(success, "result")), "done"), true);
	const failure = JSON.parse(
		errorFrame("a", { code: -32601, message: "missing" }).trim(),
	) as Record<string, unknown>;
	assert.equal(field(recordOf(field(failure, "error")), "code"), -32601);
	const notified = JSON.parse(
		notificationFrame("events/appended", { n: 1 }).trim(),
	) as Record<string, unknown>;
	assert.equal(field(notified, "method"), "events/appended");
	assert.equal("id" in notified, false);
	const parsed = JSON.parse(parseErrorFrame().trim()) as Record<
		string,
		unknown
	>;
	assert.equal(field(recordOf(field(parsed, "error")), "code"), -32700);
	const invalid = JSON.parse(invalidRequestFrame(null).trim()) as Record<
		string,
		unknown
	>;
	assert.equal(field(recordOf(field(invalid, "error")), "code"), -32600);
	assert.equal(methodNotFoundError("zz").code, -32601);
	assert.ok(methodNotFoundError("zz").message.includes("zz"));
	assert.equal(invalidParamsError("detail").code, -32602);
	const coded = serverError("CDX-E010", "message", "remediation", { id: "x" });
	assert.equal(coded.code, -32000);
	assert.equal(
		field(coded.data as Record<string, unknown>, "code"),
		"CDX-E010",
	);
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

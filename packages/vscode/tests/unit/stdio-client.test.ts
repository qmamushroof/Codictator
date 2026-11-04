// SPEC §4.20.1 Engine: the stdio client regression pin. parseJsonLine
// narrows every stdout line, engineArgvFor names the per-folder argv,
// routeEngineRequests fails closed on unknown folders, and spawnStdioEngine
// handshakes against a temp-dir fake engine without touching the network.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	activateExtension,
	activateWithHost,
} from "../../src/engine-activation.ts";
import {
	arrayFieldOf,
	engineRequestFor,
	numberFieldOf,
	parseJsonLine,
	stringFieldOf,
} from "../../src/engine-client.ts";
import { enginePathFor } from "../../src/host-adapter.ts";
import {
	resetEngineRequest,
	resetTimelineSource,
	subscribeTimeline,
} from "../../src/main.ts";
import type { StdioEngineHandle } from "../../src/stdio-client.ts";
import {
	engineArgvFor,
	routeEngineRequests,
	spawnStdioEngine,
} from "../../src/stdio-client.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function waitForAppended(seen: () => boolean): Promise<void> {
	return (async (): Promise<void> => {
		for (let attempt = 0; attempt < 250; attempt += 1) {
			if (seen()) {
				return;
			}
			await sleep(20);
		}
		throw new Error("timed out waiting for events/appended");
	})();
}

function stubSource(): string {
	return [
		'import readline from "node:readline";',
		"const iface = readline.createInterface({ input: process.stdin });",
		"function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }",
		'iface.on("line", (line) => {',
		'  if (line.trim() === "") { return; }',
		"  let message;",
		"  try { message = JSON.parse(line); } catch { return; }",
		'  if (typeof message !== "object" || message === null) { return; }',
		"  const id = message.id;",
		'  if (message.method === "initialize" && typeof id === "number") {',
		'    send({ jsonrpc: "2.0", id, result: { protocolVersion: 1 } });',
		'    process.stdout.write("\\n");',
		'    process.stdout.write("this is not json\\n");',
		'    send({ jsonrpc: "2.0", id: 9999, result: {} });',
		'    send({ jsonrpc: "2.0", method: "events/appended", params: {} });',
		"    return;",
		"  }",
		'  if (typeof id !== "number") { return; }',
		'  if (message.method === "fail") {',
		'    send({ jsonrpc: "2.0", id, error: { code: -1, message: "boom" } });',
		"    return;",
		"  }",
		'  if (message.method === "fail-raw") {',
		'    send({ jsonrpc: "2.0", id, error: "boom" });',
		"    return;",
		"  }",
		'  send({ jsonrpc: "2.0", id, result: { ok: true } });',
		"});",
		"process.stdin.resume();",
	].join("\n");
}

function createTempFolderWithEngine(): string {
	const folder = mkdtempSync(join(tmpdir(), "codictator-stdio-"));
	mkdirSync(join(folder, ".codictator", "bin"), { recursive: true });
	writeFileSync(enginePathFor(folder), stubSource(), "utf8");
	return folder;
}

function fakeRouteHandle(folder: string): StdioEngineHandle {
	return {
		dispose: (): void => undefined,
		folderPath: folder,
		onEventsAppended: (
			_listener: (folderPath: string) => void,
		): { dispose(): void } => ({
			dispose: (): void => undefined,
		}),
		ready: Promise.resolve("1"),
		request: (
			folderPath: string,
			method: string,
			_params: unknown,
		): Promise<unknown> => Promise.resolve({ folderPath, method }),
	};
}

test("[§4.20.1] parseJsonLine reads a valid object line", () => {
	// The handshake and every answer arrive as one NDJSON object per line.
	assert.deepEqual(parseJsonLine('{"jsonrpc":"2.0","id":1}'), {
		id: 1,
		jsonrpc: "2.0",
	});
});

test("[§4.20.1] parseJsonLine drops malformed JSON", () => {
	// A truncated stdout chunk reads as undefined and the caller drops it
	// without settling a waiter.
	assert.equal(parseJsonLine("this is not json"), undefined);
	assert.equal(parseJsonLine('{"id":'), undefined);
});

test("[§4.20.1] parseJsonLine drops non-object JSON and empty lines", () => {
	// Only records narrow; arrays, scalars and blank keepalive lines never
	// reach the waiter table.
	assert.equal(parseJsonLine("[1,2]"), undefined);
	assert.equal(parseJsonLine("42"), undefined);
	assert.equal(parseJsonLine('"hi"'), undefined);
	assert.equal(parseJsonLine("null"), undefined);
	assert.equal(parseJsonLine(""), undefined);
});

test("[§4.20.1] narrowing guards stay closed on non-records", () => {
	// The stdio answers are unknown, so every view narrows instead of
	// casting; a non-record reads as absent.
	assert.equal(stringFieldOf(null, "message"), undefined);
	assert.equal(numberFieldOf("nope", "protocolVersion"), undefined);
	assert.deepEqual(arrayFieldOf(null, "events"), []);
});

test("[§4.20.2] the default engine answers events/tail live-shaped", async () => {
	// Without a spawned engine the canned tail keeps the Timeline view
	// live-shaped: one epoch row and no corruption.
	const answer = await engineRequestFor()("/repo", "events/tail", {});
	assert.deepEqual(arrayFieldOf(answer, "events").length, 1);
});

test("[§4.20.1] engineArgvFor names the per-folder stdio engine", () => {
	// One `node <root>/.codictator/bin/run.mjs serve --stdio` child per
	// folder with a config; no shell, no extra flags.
	assert.deepEqual(engineArgvFor("/repo"), [
		enginePathFor("/repo"),
		"serve",
		"--stdio",
	]);
});

test("[§4.20.1] routeEngineRequests rejects unknown folders", async () => {
	// A misroute rejects instead of answering canned data, so it can never
	// look healthy.
	const request = routeEngineRequests(new Map());
	await assert.rejects(
		request("/missing", "rules/list", {}),
		/no engine for \/missing/,
	);
});

test("[§4.20.1] routeEngineRequests routes known handles", async () => {
	// A known folder reaches its per-folder handle with method and params.
	const request = routeEngineRequests(
		new Map([["/repo", fakeRouteHandle("/repo")]]),
	);
	assert.deepEqual(await request("/repo", "rules/list", {}), {
		folderPath: "/repo",
		method: "rules/list",
	});
});

test("[§4.20.1] spawnStdioEngine handshakes, routes and fans out", async () => {
	// The temp-dir stub answers initialize with protocolVersion 1, echoes
	// {ok:true} for queries, rejects error methods, and emits one
	// events/appended notification; garbage and stray-id lines are dropped.
	const folder = createTempFolderWithEngine();
	let handle: StdioEngineHandle | undefined;
	try {
		handle = spawnStdioEngine(folder);
		const appended: Array<string> = [];
		const subscription = handle.onEventsAppended((changed) => {
			appended.push(changed);
		});
		assert.equal(await handle.ready, "1");
		await waitForAppended(() => appended.length > 0);
		assert.deepEqual(appended, [folder]);
		assert.deepEqual(await handle.request(folder, "rules/list", {}), {
			ok: true,
		});
		await assert.rejects(handle.request(folder, "fail", {}), /boom/);
		await assert.rejects(
			handle.request(folder, "fail-raw", {}),
			/engine error/,
		);
		subscription.dispose();
		const pending = handle.request(folder, "rules/list", {});
		handle.dispose();
		await assert.rejects(pending);
		await assert.rejects(
			handle.request(folder, "rules/list", {}),
			/engine closed/,
		);
		handle.dispose();
	} finally {
		handle?.dispose();
		rmSync(folder, { force: true, recursive: true });
	}
});

test("[§4.20.1] activateWithHost resolves for a shapeless host", async () => {
	// A shapeless host still activates the narrow-port fallback path, so
	// views stay live instead of "no data provider"; nothing spawns.
	try {
		const throwing = (): StdioEngineHandle => {
			throw new Error("must not spawn without folders");
		};
		await activateWithHost(null, undefined, throwing);
		await activateWithHost(undefined, undefined, throwing);
		await activateWithHost(42, undefined, throwing);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.1] timeline fanout dispose releases every handle", async () => {
	// activateExtension fans events/appended out through the Timeline
	// source; disposing the subscription releases each handle once.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	const released: Array<string> = [];
	const handle: StdioEngineHandle = {
		dispose: (): void => undefined,
		folderPath: "/repo",
		onEventsAppended: (
			_listener: (folderPath: string) => void,
		): { dispose(): void } => ({
			dispose: (): void => {
				released.push("/repo");
			},
		}),
		ready: Promise.resolve("1"),
		request: (
			_folderPath: string,
			_method: string,
			_params: unknown,
		): Promise<unknown> => Promise.resolve({}),
	};
	try {
		await activateExtension(api, () => handle);
		const subscription = subscribeTimeline("/repo", () => undefined);
		subscription.dispose();
		assert.deepEqual(released, ["/repo"]);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

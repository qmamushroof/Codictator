// SPEC §4.20.1 handshake + cwd, EC-12 stderr: engine process regression
// pins. The spawn pins the folder as cwd with stderr piped, the handshake
// rejects a foreign root, a version-less answer and an unsupported
// protocol, every stderr line reaches the output channel, and one death
// schedules exactly one rescue.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { enginePathFor } from "../../src/main.ts";
import type { ReconnectHooks } from "../../src/reconnect.ts";
import { watchHandle } from "../../src/reconnect.ts";
import type { StdioEngineHandle } from "../../src/stdio-client.ts";
import { spawnStdioEngine } from "../../src/stdio-client.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function waitFor(ready: () => boolean): Promise<void> {
	return (async (): Promise<void> => {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (ready()) {
				return;
			}
			await sleep(10);
		}
		throw new Error("timed out waiting for the engine log");
	})();
}

// Windows holds the child cwd until the kill lands, so removal retries
// instead of racing the exit.
async function removeFolder(folder: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			rmSync(folder, { force: true, recursive: true });
			return;
		} catch {
			await sleep(100);
		}
	}
	rmSync(folder, { force: true, recursive: true });
}

type StubMode =
	| "echo-cwd"
	| "foreign-root"
	| "no-version"
	| "bad-protocol"
	| "stderr-exit"
	| "burst";

function stubSource(mode: StubMode): string {
	if (mode === "stderr-exit") {
		return [
			'process.stderr.write("simulated engine failure detail\\n");',
			"process.exit(1);",
		].join("\n");
	}
	if (mode === "burst") {
		return [
			'for (let i = 0; i < 201; i += 1) { process.stderr.write("burst-" + i + "\\n"); }',
			"process.exit(1);",
		].join("\n");
	}
	const result =
		mode === "echo-cwd"
			? "{ protocolVersion: 1, root: process.cwd() }"
			: mode === "foreign-root"
				? '{ protocolVersion: 1, root: "/elsewhere" }'
				: mode === "no-version"
					? "{}"
					: "{ protocolVersion: 999, root: process.cwd() }";
	return [
		'import readline from "node:readline";',
		"const iface = readline.createInterface({ input: process.stdin });",
		'iface.on("line", (line) => {',
		'  if (line.trim() === "") { return; }',
		"  let message;",
		"  try { message = JSON.parse(line); } catch { return; }",
		'  if (typeof message !== "object" || message === null) { return; }',
		"  const id = message.id;",
		'  if (message.method === "initialize" && typeof id === "number") {',
		'    process.stderr.write("engine-root:" + process.cwd() + "\\n");',
		`    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: ${result} }) + "\\n");`,
		"    return;",
		"  }",
		'  if (typeof id !== "number") { return; }',
		'  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }) + "\\n");',
		"});",
		"process.stdin.resume();",
	].join("\n");
}

function createTempFolderWithEngine(mode: StubMode): string {
	const folder = mkdtempSync(join(tmpdir(), "codictator-pr1-"));
	mkdirSync(join(folder, ".codictator", "bin"), { recursive: true });
	writeFileSync(enginePathFor(folder), stubSource(mode), "utf8");
	return folder;
}

function spawnLogged(folder: string, logs: Array<string>): StdioEngineHandle {
	return spawnStdioEngine(folder, (message: string): void => {
		logs.push(message);
	});
}

test("[§4.20.1] the engine spawns with the folder as cwd and stderr reaches the output channel", async () => {
	// SPEC §4.20.1 Engine: serve resolves its root from the child cwd, so
	// the spawn pins cwd at the folder; the child's stderr line names that
	// cwd, which only arrives when stderr is piped and streamed.
	const folder = createTempFolderWithEngine("echo-cwd");
	const logs: Array<string> = [];
	let handle: StdioEngineHandle | undefined;
	try {
		handle = spawnLogged(folder, logs);
		assert.equal(await handle.ready, "1");
		await waitFor(() => logs.some((line) => line.includes(folder)));
	} finally {
		handle?.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20.1] the handshake fails closed when the engine root mismatches the folder", async () => {
	// SPEC §4.20.1 Engine: the handshake compares initialize.root with the
	// folder, so an engine serving another root never populates the views.
	const folder = createTempFolderWithEngine("foreign-root");
	const logs: Array<string> = [];
	const handle = spawnLogged(folder, logs);
	try {
		await assert.rejects(handle.ready, /is not the folder/);
		assert.ok(logs.some((line) => line.includes("handshake failed")));
	} finally {
		handle.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20.1] the handshake fails closed without a protocol version", async () => {
	// SPEC §4.20.1 Engine: an answer without protocolVersion stays inert
	// instead of misreading rows.
	const folder = createTempFolderWithEngine("no-version");
	const logs: Array<string> = [];
	const handle = spawnLogged(folder, logs);
	try {
		await assert.rejects(handle.ready, /missing protocolVersion/);
		assert.ok(logs.some((line) => line.includes("handshake failed")));
	} finally {
		handle.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20.1] the handshake fails closed on an unsupported protocol", async () => {
	// SPEC §4.20.1 Engine: a newer protocol stays inert and names which
	// side to update instead of misreading rows.
	const folder = createTempFolderWithEngine("bad-protocol");
	const logs: Array<string> = [];
	const handle = spawnLogged(folder, logs);
	try {
		await assert.rejects(handle.ready, /unsupported/);
		assert.ok(logs.some((line) => line.includes("protocol 999")));
	} finally {
		handle.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20 EC-12] engine stderr reaches the output channel when the child dies", async () => {
	// SPEC §4.20 EC-12: a child that dies on startup leaves its stderr
	// line in the output channel instead of dying silent.
	const folder = createTempFolderWithEngine("stderr-exit");
	const logs: Array<string> = [];
	const handle = spawnLogged(folder, logs);
	try {
		await assert.rejects(handle.ready);
		await waitFor(() =>
			logs.some((line) => line.includes("simulated engine failure detail")),
		);
	} finally {
		handle.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20 EC-12] the stderr ring keeps the last 200 lines", async () => {
	// SPEC §4.20 EC-12: a 201-line burst streams every line while the ring
	// keeps the tail; the first and the last line both land in the channel.
	const folder = createTempFolderWithEngine("burst");
	const logs: Array<string> = [];
	const handle = spawnLogged(folder, logs);
	try {
		await assert.rejects(handle.ready);
		await waitFor(() => logs.some((line) => line.includes("burst-200")));
		assert.ok(logs.some((line) => line.includes("burst-0")));
	} finally {
		handle.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20 EC-2] one death schedules exactly one rescue", async () => {
	// SPEC §4.20 EC-2: the close and the ready rejection fire together, so
	// the watch dedupes them into a single backoff wait.
	const folder = createTempFolderWithEngine("stderr-exit");
	const logs: Array<string> = [];
	const handle = spawnLogged(folder, logs);
	const hooks: ReconnectHooks = {
		delay: () => new Promise(() => undefined),
		forget: () => undefined,
		log: (message) => {
			logs.push(message);
		},
		readopt: () => undefined,
		repopulate: () => undefined,
	};
	try {
		watchHandle(handle, hooks);
		await assert.rejects(handle.ready);
		await waitFor(() => logs.some((line) => line.includes("retrying in 1s")));
		await sleep(100);
		assert.equal(logs.filter((line) => line.includes("retrying")).length, 1);
	} finally {
		handle.dispose();
		await removeFolder(folder);
	}
});

test("[§4.20 EC-2] a missing folder fails closed with CDX-E002", async () => {
	// SPEC §4.19.4: a spawn that cannot start (here a missing cwd, like a
	// missing node) reports CDX-E002 instead of a bare ENOENT.
	const logs: Array<string> = [];
	const handle = spawnLogged(join(tmpdir(), "codictator-no-such-dir"), logs);
	try {
		await assert.rejects(handle.ready);
		await waitFor(() => logs.some((line) => line.includes("CDX-E002")));
	} finally {
		handle.dispose();
	}
});

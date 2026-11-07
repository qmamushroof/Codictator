// SPEC §4.20 EC-11 and EC-12: the live-extension hardening red tests. The
// on-save matcher must compare win32 backslash paths without string
// prefixes, and engine stderr must reach the output-channel log. Both fail
// until PR 1 wires the fixes; the ledger holds them red meanwhile.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { enginePathFor } from "../../src/host-adapter.ts";
import { onDidSaveOf } from "../../src/save-notification.ts";
import { spawnStdioEngine } from "../../src/stdio-client.ts";
import type { SaveEvent } from "../../src/views.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function waitForSeen(seen: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 250; attempt += 1) {
		if (seen()) {
			return;
		}
		await sleep(20);
	}
	throw new Error("timed out waiting for the expected event");
}

test("[§4.20 EC-11] on-save matches win32 backslash paths without string prefixes", () => {
	// A save under a win32 folder must resolve to that folder even though
	// the fsPath never contains a forward slash after the folder.
	const folder = "C:\\repo";
	const seen: Array<SaveEvent> = [];
	let saved: ((document: unknown) => void) | undefined;
	const host = {
		workspace: {
			onDidSaveTextDocument: (listener: (document: unknown) => void) => {
				saved = listener;
				return {
					dispose: (): void => undefined,
				};
			},
		},
	};
	const subscribe = onDidSaveOf(host, () => [folder]);
	assert.equal(typeof subscribe, "function");
	if (typeof subscribe === "function") {
		subscribe((event) => {
			seen.push(event);
		});
	}
	assert.equal(typeof saved, "function");
	if (typeof saved === "function") {
		saved({ uri: { fsPath: "C:\\repo\\src\\a.ts" } });
	}
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.folderPath, folder);
});

function stderrEngineStub(): string {
	return [
		'import readline from "node:readline";',
		'process.stderr.write("engine-stderr-marker\\n");',
		"const iface = readline.createInterface({ input: process.stdin });",
		'iface.on("line", (line) => {',
		'  if (line.trim() === "") { return; }',
		"  let message;",
		"  try { message = JSON.parse(line); } catch { return; }",
		'  if (typeof message !== "object" || message === null) { return; }',
		"  const id = message.id;",
		'  if (typeof id !== "number") { return; }',
		'  if (message.method === "initialize") {',
		'    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: 1 } }) + "\\n");',
		"    return;",
		"  }",
		'  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }) + "\\n");',
		"});",
		"process.stdin.resume();",
	].join("\n");
}

test("[§4.20 EC-12] engine stderr reaches the output-channel log", async () => {
	// The child writes one stderr line at startup; the client must surface
	// it through the log port instead of discarding it.
	const folder = mkdtempSync(join(tmpdir(), "codictator-stderr-"));
	mkdirSync(join(folder, ".codictator", "bin"), { recursive: true });
	writeFileSync(enginePathFor(folder), stderrEngineStub(), "utf8");
	const lines: Array<string> = [];
	const handle = spawnStdioEngine(folder, (message: string) => {
		lines.push(message);
	});
	try {
		await handle.ready;
		await waitForSeen(() =>
			lines.some((line) => line.includes("engine-stderr-marker")),
		);
	} finally {
		handle.dispose();
		rmSync(folder, { recursive: true, force: true });
	}
});

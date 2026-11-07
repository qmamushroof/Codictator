// SPEC §4.20.2 failView labels, EC-2/EC-3 reconnect: label and restart
// regression pins. A method error shows the method error item with its
// Explain action instead of the disconnected row, a dead engine retries
// with backoff while the views read disconnected, and a lock save
// restarts the engine at once.
import { strict as assert } from "node:assert";
import test from "node:test";
import { activateExtension } from "../../src/engine-activation.ts";
import { resetEngineRequest, resetTimelineSource } from "../../src/main.ts";
import {
	defaultDelay,
	reconnectDelayMs,
	shouldRestartOnLockChange,
} from "../../src/reconnect.ts";
import type { StdioEngineHandle } from "../../src/stdio-client.ts";
import { createViewProvider, errorItem } from "../../src/tree-provider.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

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
		throw new Error("timed out waiting for the reconnect");
	})();
}

function labelsOf(
	api: ReturnType<typeof createFakeVscode>,
	viewId: string,
): Array<string> {
	const provider = api.treeProviders.get(viewId);
	assert.ok(provider !== undefined, `view ${viewId} registered`);
	return provider
		.getChildren()
		.map((child) => provider.getTreeItem(child).label);
}

function silentHandle(): StdioEngineHandle {
	return {
		dispose: (): void => undefined,
		folderPath: "/repo",
		onEventsAppended: (
			_listener: (folderPath: string) => void,
		): { dispose(): void } => ({
			dispose: (): void => undefined,
		}),
		ready: Promise.resolve("1"),
		request: () => Promise.resolve({}),
	};
}

function deadHandle(): StdioEngineHandle {
	return {
		...silentHandle(),
		ready: Promise.reject(new Error("engine boom")),
	};
}

test("[§4.20.2] method errors show the method error item, not disconnected", async () => {
	// SPEC §4.20.2: a failing rules/list names its method and carries the
	// Explain action; the disconnected row stays for a real disconnect.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	const handle: StdioEngineHandle = {
		...silentHandle(),
		request: () => Promise.reject(new Error("CDX-E999 simulated failure")),
	};
	try {
		await activateExtension(api, () => handle);
		const provider = api.treeProviders.get("codictator-active-rules");
		assert.ok(provider !== undefined);
		const children = provider.getChildren();
		assert.equal(children.length, 1);
		const item = provider.getTreeItem(children[0]);
		assert.match(item.label, /rules\/list/);
		assert.notEqual(item.label, "Disconnected: engine not running");
		assert.equal(item.command?.command, "codictator.explain");
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.2] the method error item names the method and carries Explain", () => {
	// SPEC §4.20.2: failView rows name the failing method with its code and
	// carry the codictator.explain action for the remediation.
	const provider = createViewProvider([
		errorItem("rules/list", "CDX-E999", "boom"),
	]);
	const children = provider.getChildren();
	assert.equal(children.length, 1);
	const item = provider.getTreeItem(children[0]);
	assert.match(item.label, /rules\/list/);
	assert.match(item.label, /CDX-E999/);
	assert.equal(item.command?.command, "codictator.explain");
});

test("[§4.20 EC-2] reconnect backoff escalates 1s, 5s, 30s and pins", () => {
	// SPEC §4.20 EC-2: consecutive failures wait 1 s, 5 s, 30 s, and later
	// attempts pin at 30 s instead of growing without bound.
	assert.deepEqual(
		[reconnectDelayMs(0), reconnectDelayMs(1), reconnectDelayMs(2)],
		[1000, 5000, 30000],
	);
	assert.equal(reconnectDelayMs(99), 30000);
	assert.equal(reconnectDelayMs(-1), 1000);
});

test("[§4.20 EC-3] the tool lock path restarts like the root lock", () => {
	// SPEC §4.20 EC-3: `.codictator/tool/package-lock.json` restarts, an
	// unrelated file and a backslash non-lock path leave the engine alone.
	assert.equal(
		shouldRestartOnLockChange(".codictator/tool/package-lock.json"),
		true,
	);
	assert.equal(shouldRestartOnLockChange("src\\index.ts"), false);
});

test("[§4.20 EC-2] the default delay waits before resolving", async () => {
	// SPEC §4.20.4: production rescue waits on a real timer; the 1 ms pin
	// proves the wait resolves instead of hanging the rescue.
	await defaultDelay(1);
});

test("[§4.20.1] a spawn throw skips the folder and the log port carries client failures", async () => {
	// SPEC §4.20.1 Engine: a spawn throw logs and skips the folder instead
	// of aborting activation, and the injected log port forwards the client
	// transport note.
	const api = createFakeVscode();
	api.addFolder("/bad", { config: true, engine: true });
	api.addFolder("/repo", { config: true, engine: true });
	const spawning = (
		folderPath: string,
		log?: (message: string) => void,
	): StdioEngineHandle => {
		log?.(`client note for ${folderPath}`);
		if (folderPath === "/bad") {
			throw new Error("spawn unavailable");
		}
		return silentHandle();
	};
	try {
		await activateExtension(api, spawning);
		assert.ok(
			api.logs.some((line) => line.includes("engine spawn failed for /bad")),
		);
		assert.ok(api.logs.some((line) => line.includes("client note for /repo")));
		assert.deepEqual(labelsOf(api, "codictator-active-rules"), [
			"No packs configured",
		]);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20 EC-2] with no engine every view stays disconnected", async () => {
	// SPEC §4.20 EC-2: with no folders no engine spawns, so every view
	// keeps the disconnected row instead of an empty tree.
	const api = createFakeVscode();
	const throwing = (): StdioEngineHandle => {
		throw new Error("must not spawn without folders");
	};
	try {
		await activateExtension(api, throwing);
		for (const viewId of [
			"codictator-active-rules",
			"codictator-violations",
			"codictator-timeline",
		]) {
			assert.deepEqual(labelsOf(api, viewId), [
				"Disconnected: engine not running",
			]);
		}
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20 EC-2] a dead engine retries with backoff", async () => {
	// SPEC §4.20 EC-2: a handshake failure reschedules the spawn with
	// backoff while the log names the retry wait.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	let spawns = 0;
	const waits: Array<number> = [];
	let releases = 2;
	const delay = (ms: number): Promise<void> => {
		waits.push(ms);
		if (releases > 0) {
			releases -= 1;
			return Promise.resolve();
		}
		return new Promise(() => undefined);
	};
	const failing = (): StdioEngineHandle => {
		spawns += 1;
		return deadHandle();
	};
	try {
		await activateExtension(api, failing, delay);
		await waitFor(() => spawns >= 3);
		assert.deepEqual(waits.slice(0, 2), [1000, 5000]);
		assert.ok(api.logs.some((line) => line.includes("retrying in 1s")));
		assert.ok(api.logs.some((line) => line.includes("retrying in 5s")));
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20 EC-3] saving package-lock.json restarts the engine", async () => {
	// SPEC §4.20 EC-3: saving the root lock or the tool lock disposes the
	// handle and spawns at once; any other save leaves it alone.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	let spawns = 0;
	let disposes = 0;
	const live = (): StdioEngineHandle => {
		spawns += 1;
		return {
			...silentHandle(),
			dispose: (): void => {
				disposes += 1;
			},
		};
	};
	try {
		await activateExtension(api, live);
		assert.equal(spawns, 1);
		api.saveDocument("/repo", "package-lock.json");
		await waitFor(() => spawns >= 2);
		assert.equal(disposes, 1);
		api.saveDocument("/repo", ".codictator/tool/package-lock.json");
		await waitFor(() => spawns >= 3);
		assert.equal(disposes, 2);
		api.saveDocument("/repo", "src/index.ts");
		await sleep(50);
		assert.equal(spawns, 3);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

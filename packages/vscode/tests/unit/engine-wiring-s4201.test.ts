import { strict as assert } from "node:assert";

import test from "node:test";

import {
	activateExtension,
	serversForFolders,
} from "../../src/engine-activation.ts";

import type { ExtensionHostFs } from "../../src/host-adapter.ts";

import {
	buildExtensionApi,
	configPathFor,
	enginePathFor,
} from "../../src/host-adapter.ts";

import {
	engineRequestFor,
	resetEngineRequest,
	resetTimelineSource,
	subscribeTimeline,
} from "../../src/main.ts";

import type { StdioEngineHandle } from "../../src/stdio-client.ts";

import { createFakeVscode } from "../support/fake-vscode.ts";

function createHost(folders: ReadonlyArray<string>): unknown {
	return {
		commands: {
			registerCommand(_commandId: string): void {
				// Recorded only to satisfy the duck-typed host shape.
			},
		},
		window: {
			registerTreeDataProvider(_viewId: string, _provider: unknown): void {
				// Recorded only to satisfy the duck-typed host shape.
			},
			createTerminal(_name: string): unknown {
				return undefined;
			},
		},
		workspace: {
			workspaceFolders: folders.map((folder) => ({ uri: { fsPath: folder } })),
		},
	};
}

function createFs(present: ReadonlySet<string>): ExtensionHostFs {
	return {
		exists: (path: string): boolean => present.has(path),
	};
}

test("[§4.20.1] serversForFolders spawns the engine argv per folder with a config", async () => {
	// SPEC §4.20.1 Engine: one `node <root>/.codictator/bin/run.mjs serve
	// --stdio` server per folder that has a config; folders without one get
	// no server.
	const api = buildExtensionApi(
		createHost(["/repo-a", "/plain"]),
		createFs(new Set([configPathFor("/repo-a"), enginePathFor("/repo-a")])),
	);
	const seen: Array<{
		folderPath: string;
		args: ReadonlyArray<string>;
	}> = [];
	const servers = await serversForFolders(api, (folderPath, args) => {
		seen.push({ args: [...args], folderPath });
		return { folderPath };
	});
	assert.deepEqual(
		servers.map((server) => server.folderPath),
		["/repo-a"],
	);
	assert.deepEqual(seen, [
		{
			args: ["node", enginePathFor("/repo-a"), "serve", "--stdio"],
			folderPath: "/repo-a",
		},
	]);
});

test("[§4.20.1] activateExtension spawns servers and routes the engine request", async () => {
	// SPEC §4.20.1 Engine (review F-01): activation starts one stdio server
	// per folder with a config through the spawn seam and routes engine
	// requests through the spawned handles instead of canned defaults.
	const api = buildExtensionApi(
		createHost(["/repo"]),
		createFs(new Set([configPathFor("/repo"), enginePathFor("/repo")])),
	);
	const spawned: Array<string> = [];
	const appended = new Set<(folderPath: string) => void>();
	const handle: StdioEngineHandle = {
		dispose: (): void => undefined,
		folderPath: "/repo",
		onEventsAppended: (listener: (folderPath: string) => void) => {
			appended.add(listener);
			return {
				dispose: (): void => {
					appended.delete(listener);
				},
			};
		},
		ready: Promise.resolve("1"),
		request: (
			_folderPath: string,
			method: string,
			_params: unknown,
		): Promise<unknown> => Promise.resolve({ method }),
	};
	try {
		await activateExtension(api, (folderPath) => {
			spawned.push(folderPath);
			return handle;
		});
		assert.deepEqual(spawned, ["/repo"]);
		const answer = await engineRequestFor()("/repo", "rules/list", {});
		assert.deepEqual(answer, { method: "rules/list" });
		await assert.rejects(engineRequestFor()("/plain", "rules/list", {}));
		const refreshed: Array<string> = [];
		subscribeTimeline("/repo", (folderPath) => {
			refreshed.push(folderPath);
		});
		for (const listener of [...appended]) {
			listener("/repo");
		}
		assert.deepEqual(refreshed, ["/repo"]);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.1] activateExtension notifies instead of spawning without an engine", async () => {
	// SPEC §4.20.1 Engine: config without an engine → the install
	// notification owns the folder and no server spawns.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: false });
	try {
		await activateExtension(api, () => {
			throw new Error("must not spawn without an engine");
		});
		assert.equal(api.notifications.length, 1);
		const notification = api.notifications[0];
		assert.ok(notification !== undefined);
		assert.match(notification.message, /npm ci/);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

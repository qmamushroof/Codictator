import { strict as assert } from "node:assert";

import test from "node:test";

import type { ExtensionHostFs } from "../../src/host-adapter.ts";

import {
	buildExtensionApi,
	configPathFor,
	enginePathFor,
} from "../../src/host-adapter.ts";

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

test("[§4.20.1] buildExtensionApi reads config presence from the injected fs", () => {
	// SPEC §4.20.1 Engine: configExists checks
	// <folder>/.codictator/config.json through the fs port.
	const api = buildExtensionApi(
		createHost(["/repo"]),
		createFs(new Set([configPathFor("/repo")])),
	);
	assert.equal(api.configExists("/repo"), true);
	assert.equal(api.configExists("/plain"), false);
});

test("[§4.20.1] buildExtensionApi reads engine presence from the injected fs", () => {
	// SPEC §4.20.1 Engine: engineExists checks
	// <folder>/.codictator/bin/run.mjs through the fs port.
	const api = buildExtensionApi(
		createHost(["/repo"]),
		createFs(new Set([enginePathFor("/repo")])),
	);
	assert.equal(api.engineExists("/repo"), true);
	assert.equal(api.engineExists("/plain"), false);
});

test("[§4.20.1] buildExtensionApi treats a throwing fs as absent", () => {
	// Without a readable config no server spawns, and without a readable
	// engine the missing-engine notification owns the folder: false is the
	// closed direction.
	const api = buildExtensionApi(createHost(["/repo"]), {
		exists: (_path: string): boolean => {
			throw new Error("unreadable");
		},
	});
	assert.equal(api.configExists("/repo"), false);
	assert.equal(api.engineExists("/repo"), false);
});

test("[§4.20.1] buildExtensionApi without an fs keeps config and engine absent", () => {
	// The fs port is optional so existing single-argument callers keep
	// working; without it both checks stay false and nothing spawns.
	const api = buildExtensionApi(createHost(["/repo"]));
	assert.equal(api.configExists("/repo"), false);
	assert.equal(api.engineExists("/repo"), false);
});

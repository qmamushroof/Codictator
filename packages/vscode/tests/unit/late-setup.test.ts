// SPEC §4.20 EC-9 + §4.20.2: late-setup reconnect and healthy-empty rows.
// Activation with no engine registers the save listener anyway, so a save
// after the human runs `setup` spawns the missing engine and connects the
// views without a reload. A connected engine with zero findings, events or
// injections keeps one plain healthy-empty row per view — never an empty
// tree and never the disconnected row.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	activateExtension,
	connectMissing,
} from "../../src/engine-activation.ts";
import { resetEngineRequest, resetTimelineSource } from "../../src/main.ts";
import type { StdioEngineHandle } from "../../src/stdio-client.ts";
import {
	createViewProvider,
	noSteeringEntriesItem,
	noTimelineEventsItem,
	noViolationsItem,
} from "../../src/tree-provider.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

function emptyCanned(method: string): unknown {
	switch (method) {
		case "rules/list": {
			return { rules: [{ id: "core/no-secrets", pack: "core@1.0.0" }] };
		}
		case "findings/list": {
			return { findings: [] };
		}
		case "events/tail": {
			return { events: [] };
		}
		case "steering/history": {
			return { injections: [] };
		}
		case "budget/current": {
			return { band: "soft", usedTokens: 10, contextWindow: 100 };
		}
		case "status": {
			return {
				ratchet: "improving",
				deps: "fresh",
				integrity: "verified",
				remediation: "none open",
			};
		}
		default: {
			return {};
		}
	}
}

function liveHandle(canned: (method: string) => unknown): StdioEngineHandle {
	return {
		dispose: (): void => undefined,
		folderPath: "/repo",
		onEventsAppended: (
			_listener: (folderPath: string) => void,
		): { dispose(): void } => ({
			dispose: (): void => undefined,
		}),
		ready: Promise.resolve("1"),
		request: (
			_folderPath: string,
			method: string,
			_params: unknown,
		): Promise<unknown> => Promise.resolve(canned(method)),
	};
}

function childLabels(
	api: ReturnType<typeof createFakeVscode>,
	viewId: string,
): Array<string> {
	const provider = api.treeProviders.get(viewId);
	assert.ok(provider !== undefined, `view ${viewId} registered`);
	return provider
		.getChildren()
		.map((child) => provider.getTreeItem(child).label);
}

async function waitFor(ready: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (ready()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting for the views to refresh");
}

test("[§4.20 EC-9] save after setup connects the missing engine", async () => {
	// SPEC §4.20 EC-9: activation with no engine shows disconnected views
	// but still registers the save listener; once the human runs `setup`
	// (config and engine on disk) the next save spawns the engine and the
	// Active rules view lists its packs.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: false });
	try {
		await activateExtension(api, () => liveHandle(emptyCanned));
		assert.deepEqual(childLabels(api, "codictator-active-rules"), [
			"Disconnected: engine not running",
		]);
		api.enginePaths.add("/repo");
		api.saveDocument("/repo", "codictator.json");
		await waitFor(() =>
			childLabels(api, "codictator-active-rules").some((row) =>
				row.includes("core@1.0.0"),
			),
		);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20 EC-9] connectMissing spawns only folders with config and engine", () => {
	// SPEC §4.20 EC-9: the save-triggered existence re-check spawns one
	// engine per folder that has both a config and an engine on disk, and
	// never respawns a folder that already has a handle.
	const api = createFakeVscode();
	api.addFolder("/a", { config: true, engine: true });
	api.addFolder("/b", { config: true, engine: false });
	api.addFolder("/plain", { config: false, engine: false });
	const providers = new Map();
	const handles = new Map<string, StdioEngineHandle>();
	let spawns = 0;
	const folders = connectMissing(api, providers, handles, () => {
		spawns += 1;
		return liveHandle(emptyCanned);
	});
	assert.deepEqual(folders, ["/a"]);
	assert.equal(spawns, 1);
	const again = connectMissing(api, providers, handles, () => {
		spawns += 1;
		return liveHandle(emptyCanned);
	});
	assert.deepEqual(again, ["/a"]);
	assert.equal(spawns, 1);
});

test("[§4.20.2] connected views with zero data keep healthy-empty rows", async () => {
	// SPEC §4.20.2: a connected engine with zero findings, events or
	// injections fills each view with one plain row — never an empty tree
	// (reads as broken) and never the disconnected row (reads as offline).
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	try {
		await activateExtension(api, () => liveHandle(emptyCanned));
		assert.deepEqual(childLabels(api, "codictator-violations"), [
			"No violations",
		]);
		assert.deepEqual(childLabels(api, "codictator-timeline"), [
			"No timeline events",
		]);
		assert.deepEqual(childLabels(api, "codictator-steering"), [
			"No steering entries",
		]);
		for (const viewId of [
			"codictator-violations",
			"codictator-timeline",
			"codictator-steering",
		]) {
			const provider = api.treeProviders.get(viewId);
			assert.ok(provider !== undefined);
			for (const child of provider.getChildren()) {
				assert.equal(provider.getTreeItem(child).command, undefined);
			}
		}
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.2] healthy-empty factories render plain rows without commands", () => {
	// SPEC §4.20.2: the command-less factories behind the healthy-empty
	// rows render their label and carry no action.
	for (const [factory, label] of [
		[noViolationsItem, "No violations"],
		[noTimelineEventsItem, "No timeline events"],
		[noSteeringEntriesItem, "No steering entries"],
	] as const) {
		const provider = createViewProvider([factory()]);
		const children = provider.getChildren();
		assert.equal(children.length, 1);
		const item = provider.getTreeItem(children[0]);
		assert.equal(item.label, label);
		assert.equal(item.command, undefined);
	}
});

// SPEC §4.20.1: the host-wiring regression pin (BUG-0025). The production
// host entry (dist/extension.cjs shim → activateWithHost) must register all
// six tree views plus the palette commands through activateExtension and
// never throw; before the fix activateWithHost threw "not implemented" so
// every view showed "no data provider".
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	ALL_VIEW_IDS,
	activateExtension,
	activateWithHost,
	resetEngineRequest,
	resetTimelineSource,
} from "../../src/main.ts";
import type {
	ExtensionCommandHandler,
	ExtensionDisposable,
} from "../../src/tree-provider.ts";
import { isTreeDataProvider } from "../../src/tree-provider.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

const PALETTE_COMMAND_IDS: ReadonlyArray<string> = [
	"codictator.verify",
	"codictator.status",
	"codictator.explain",
	"codictator.regen",
	"codictator.remediateNext",
	"codictator.taskShow",
	"codictator.waive",
];

function createFakeHost(): {
	host: unknown;
	viewIds: Array<string>;
	commandIds: Array<string>;
	providers: Map<string, unknown>;
	handlers: Map<string, ExtensionCommandHandler>;
} {
	const viewIds: Array<string> = [];
	const commandIds: Array<string> = [];
	const providers = new Map<string, unknown>();
	const handlers = new Map<string, ExtensionCommandHandler>();
	const disposable = (): ExtensionDisposable => ({
		dispose: (): void => undefined,
	});
	const host = {
		commands: {
			registerCommand(
				commandId: string,
				handler: ExtensionCommandHandler,
			): ExtensionDisposable {
				// The real extHost throws without a function handler.
				if (typeof handler !== "function") {
					throw new TypeError(`command ${commandId} needs a function handler`);
				}
				commandIds.push(commandId);
				handlers.set(commandId, handler);
				return disposable();
			},
		},
		window: {
			registerTreeDataProvider(
				viewId: string,
				provider: unknown,
			): ExtensionDisposable {
				// The real extHost renders by calling getChildren, so a
				// provider without function-typed entries throws here.
				if (!isTreeDataProvider(provider)) {
					throw new TypeError(`view ${viewId} needs a tree data provider`);
				}
				viewIds.push(viewId);
				providers.set(viewId, provider);
				return disposable();
			},
			createTerminal(_name: string): unknown {
				return undefined;
			},
		},
		workspace: {},
	};
	return { commandIds, handlers, host, providers, viewIds };
}

test("[§4.20.1] activateWithHost registers all six views and palette commands without throwing", async () => {
	// SPEC §4.20.1 Module format: the shim passes the host vscode API object
	// to activateWithHost, which narrows it by duck-typing (window.
	// registerTreeDataProvider + commands.registerCommand) and activates
	// through the same path as the unit-test fake, so all six views stay
	// live instead of "no data provider".
	const { host, viewIds, commandIds } = createFakeHost();
	await activateWithHost(host);
	for (const viewId of ALL_VIEW_IDS) {
		assert.ok(viewIds.includes(viewId), `host registered tree view ${viewId}`);
	}
	assert.equal(new Set(viewIds).size, ALL_VIEW_IDS.length);
	assert.deepEqual([...new Set(viewIds)].sort(), [...ALL_VIEW_IDS].sort());
	for (const commandId of PALETTE_COMMAND_IDS) {
		assert.ok(
			commandIds.includes(commandId),
			`host registered palette command ${commandId}`,
		);
	}
});

test("[§4.20.2] registered tree providers render labels without throwing", async () => {
	// A plain `{items}` object used to reach the host, so every view threw
	// `provider.getChildren is not a function` at render. The probe renders
	// each registered provider the way extHost does.
	const { host, providers } = createFakeHost();
	await activateWithHost(host);
	for (const viewId of ALL_VIEW_IDS) {
		const raw = providers.get(viewId);
		if (!isTreeDataProvider(raw)) {
			assert.fail(`view ${viewId} registered a provider`);
		}
		for (const child of await raw.getChildren()) {
			assert.equal(typeof raw.getTreeItem(child).label, "string");
		}
	}
});

test("[§4.20.3] registered palette commands invoke through the engine run path", async () => {
	// Palette entries used to register with no callback, so invoking them
	// did nothing. The probe invokes every palette handler and expects the
	// engine `run` outcome, or the human-only pre-filled command line.
	// Integrity exception: the probe stays scoped to the palette set plus
	// setup. The PR4 view-action commands (restart, show log, refresh,
	// focus, load more, install, baseline, deps check, open, waive) answer
	// void by contract — they act through ports instead of answering a
	// command line — so invoking them here would fail a contract they never
	// held. Their routing is pinned by ux-commands / ux-violations tests.
	const { handlers, host } = createFakeHost();
	await activateWithHost(host);
	assert.ok(handlers.size >= PALETTE_COMMAND_IDS.length);
	for (const commandId of [...PALETTE_COMMAND_IDS, "codictator.setup"]) {
		const handler = handlers.get(commandId);
		assert.ok(handler !== undefined, `palette command ${commandId} registered`);
		const outcome = await handler();
		if (typeof outcome !== "string" || outcome === "") {
			assert.fail(`command ${commandId} answers a command line`);
		}
	}
});

test("[§4.20.1] activateExtension registers all six view ids on the fake api", async () => {
	// SPEC §4.20.1: activation registers every tree view id in ALL_VIEW_IDS
	// on the extension api, so the container owns all six views.
	const api = createFakeVscode();
	await activateExtension(api);
	for (const viewId of ALL_VIEW_IDS) {
		assert.ok(api.treeProviders.has(viewId), `api registered ${viewId}`);
	}
	assert.equal(api.treeProviders.size, ALL_VIEW_IDS.length);
});

test("[§4.20.2] disconnected views show an offline item instead of staying empty", async () => {
	// SPEC §4.20.2 (BUG-0032): with no engine to spawn, every registered
	// view shows one offline item, so the container never renders an empty
	// view that reads as broken.
	const api = createFakeVscode();
	try {
		await activateExtension(api, () => {
			throw new Error("must not spawn without folders");
		});
		for (const viewId of ALL_VIEW_IDS) {
			const provider = api.treeProviders.get(viewId);
			assert.ok(provider !== undefined, `view ${viewId} registered`);
			const children = provider.getChildren();
			assert.ok(children.length >= 1, `view ${viewId} is not empty`);
			const labels = children.map((child) => provider.getTreeItem(child).label);
			assert.match(labels.join("\n"), /disconnect/i);
		}
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

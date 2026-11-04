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
} from "../../src/main.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

const PALETTE_COMMAND_IDS: ReadonlyArray<string> = [
	"codictator.verify",
	"codictator.status",
	"codictator.explain",
	"codictator.regen",
	"codictator.remediateNext",
	"codictator.taskShow",
];

function createFakeHost(): {
	host: unknown;
	viewIds: Array<string>;
	commandIds: Array<string>;
} {
	const viewIds: Array<string> = [];
	const commandIds: Array<string> = [];
	const host = {
		commands: {
			registerCommand(commandId: string): void {
				commandIds.push(commandId);
			},
		},
		window: {
			registerTreeDataProvider(viewId: string, _provider: unknown): void {
				viewIds.push(viewId);
			},
			createTerminal(_name: string): unknown {
				return undefined;
			},
		},
		workspace: {},
	};
	return { host, viewIds, commandIds };
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

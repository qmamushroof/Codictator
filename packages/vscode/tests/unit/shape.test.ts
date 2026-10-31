// SPEC §4.20.1: extension shape with a fake vscode API object. Each test pins
// one shape row (or EC-9) against the extension entry implemented in step 11.2.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	activateExtension,
	activationEvents,
	checkProtocolVersion,
	notifyMissingEngine,
	runSetupWelcome,
	serversForFolders,
	untrustedWorkspaceSupport,
} from "../../src/main.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

test("[§4.20.1] shim loads the ESM main with the injected vscode API", async () => {
	// SPEC §4.20.1 Module format: the CommonJS shim dynamic-imports the ESM
	// dist/main.js and passes it the vscode API object; main activates with
	// that object instead of a global.
	const api = createFakeVscode();
	const other = createFakeVscode();
	await activateExtension(api);
	assert.ok(api.commands.length > 0);
	assert.equal(other.commands.length, 0);
});

test("[§4.20.1] activation triggers on workspace config or the Codictator view", () => {
	// SPEC §4.20.1 Activation: workspaceContains:.codictator/config.json, or
	// opening the Codictator view.
	const events = activationEvents();
	assert.ok(events.includes("workspaceContains:.codictator/config.json"));
	assert.ok(events.some((event) => event.includes("Codictator")));
});

test("[§4.20.1] untrusted workspaces are unsupported", () => {
	// SPEC §4.20.1 Trust: the extension executes the repo engine, so it runs
	// only in trusted workspaces.
	assert.equal(untrustedWorkspaceSupport(), false);
});

test("[§4.20.1] one server spawns per workspace folder with a config", async () => {
	// SPEC §4.20.1 Engine: one stdio server per folder that has a config;
	// folders without a config get no server and nothing is bundled.
	const api = createFakeVscode();
	api.addFolder("/repo-a", { config: true, engine: true });
	api.addFolder("/repo-b", { config: true, engine: true });
	api.addFolder("/plain", { config: false, engine: false });
	const servers = await serversForFolders(api);
	assert.deepEqual(servers.map((server) => server.folderPath).sort(), [
		"/repo-a",
		"/repo-b",
	]);
});

test("[§4.20.1] protocol mismatch stays inert with an update direction", () => {
	// SPEC §4.20.1 Protocol: an unsupported initialize.protocolVersion stays
	// inert and names which side to update.
	const behind = checkProtocolVersion("0.0.0");
	assert.equal(behind.inert, true);
	assert.match(behind.direction, /update codictator/);
	const ahead = checkProtocolVersion("9999.0.0");
	assert.equal(ahead.inert, true);
	assert.match(ahead.direction, /update the extension/);
});

test("[§4.20 EC-9] setup welcome pre-fills the init terminal and runs nothing", async () => {
	// SPEC §4.20.1 Onboarding + EC-9: in a trusted folder without a config the
	// view offers "Set up Codictator"; init is human-only, so the action opens
	// a terminal pre-filled with the init command and runs nothing by itself.
	const api = createFakeVscode();
	api.addFolder("/fresh", { config: false, engine: true });
	const outcome = await runSetupWelcome(api, "/fresh");
	assert.equal(outcome.executed, false);
	assert.equal(api.executedShellCommands.length, 0);
	assert.equal(api.terminals.length, 1);
	const terminal = api.terminals[0];
	assert.ok(terminal !== undefined);
	assert.equal(terminal.shown, true);
	assert.equal(terminal.sentTexts.length, 1);
	const sent = terminal.sentTexts[0];
	assert.ok(sent !== undefined);
	assert.match(sent.text, /^npx codictator@\S+ init$/);
	assert.equal(sent.execute, false);
	assert.equal(outcome.prefilledCommand, sent.text);
});

test("[§4.20.1] missing engine notifies with an install-terminal offer", async () => {
	// SPEC §4.20.1 Engine: no engine installed → a notification offering to
	// run the install (npm ci) in a terminal.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: false });
	api.notificationChoice = "Install in a terminal";
	const chosen = await notifyMissingEngine(api, "/repo");
	assert.equal(api.notifications.length, 1);
	const notification = api.notifications[0];
	assert.ok(notification !== undefined);
	assert.match(notification.message, /npm ci/);
	assert.equal(chosen, "Install in a terminal");
	assert.equal(api.terminals.length, 1);
});

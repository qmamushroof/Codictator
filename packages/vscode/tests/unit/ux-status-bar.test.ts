// SPEC §4.20.2: the PR4 status bar item. Red-first: status-bar.ts does
// not exist yet, so every test below fails until it lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	registerStatusBar,
	type StatusBarItemHandle,
	type StatusBarPorts,
	statusBarContent,
} from "../../src/status-bar.ts";

test("[§4.20.2] status bar shows the shield with rule and block counts and focuses the view on click", () => {
	// SPEC §4.20.2 PR4: connected state reads
	// `$(shield) Codictator: 83 rules · 2 blocks`; clicking focuses the view.
	const content = statusBarContent({
		blockCount: 2,
		connection: "connected",
		ruleCount: 83,
	});
	assert.equal(content.text, "$(shield) Codictator: 83 rules · 2 blocks");
	assert.equal(content.command, "codictator.focusViews");
	assert.match(content.tooltip, /83 rules/);
});

test("[§4.20.2] status bar shows the connecting spinner while the engine starts", () => {
	// SPEC §4.20.2 PR4: the connecting state spins instead of counts.
	const content = statusBarContent({
		blockCount: 0,
		connection: "connecting",
		ruleCount: 0,
	});
	assert.match(content.text, /\$\(sync~spin\)/);
	assert.match(content.text, /connecting/);
});

test("[§4.20.2] status bar shows the engine error code and the budget band colour when known", () => {
	// SPEC §4.20.2 PR4: `$(error) engine error` names the CDX code; a known
	// budget band tints the item.
	const errored = statusBarContent({
		blockCount: 0,
		connection: "engine-error",
		errorCode: "CDX-E002",
		ruleCount: 0,
	});
	assert.match(errored.text, /\$\(error\)/);
	assert.match(errored.text, /CDX-E002/);
	const banded = statusBarContent({
		band: "amber",
		blockCount: 1,
		connection: "connected",
		ruleCount: 10,
	});
	assert.equal(banded.color, "#e5a50a");
	const green = statusBarContent({
		band: "green",
		blockCount: 0,
		connection: "connected",
		ruleCount: 10,
	});
	assert.equal(green.color, undefined);
});

test("[§4.20.2] status bar names unseen blocks and the missing engine", () => {
	// SPEC §4.20.2 PR4: the badge count rides the item text; a missing
	// engine names the repair.
	const unseen = statusBarContent({
		blockCount: 2,
		connection: "connected",
		ruleCount: 83,
		unseenBlocks: 3,
	});
	assert.match(unseen.text, /3 new/);
	const missing = statusBarContent({
		blockCount: 0,
		connection: "engine-missing",
		ruleCount: 0,
	});
	assert.match(missing.text, /engine missing/);
	assert.match(missing.tooltip, /not installed/);
});

test("[§4.20.2] status bar registration updates text on state changes and focuses views on click", () => {
	// SPEC §4.20.2 PR4: the registered item re-renders per update; the
	// click command is the focus command the UX commands register.
	const item: StatusBarItemHandle & { showCalls: number } = {
		dispose: (): void => undefined,
		show: (): void => {
			item.showCalls += 1;
		},
		showCalls: 0,
		text: "",
		tooltip: "",
	};
	const ports: StatusBarPorts = {
		createItem: () => item,
	};
	const bar = registerStatusBar(ports);
	bar.update({ blockCount: 0, connection: "connecting", ruleCount: 0 });
	assert.match(item.text, /connecting/);
	bar.update({ blockCount: 2, connection: "connected", ruleCount: 83 });
	assert.equal(item.text, "$(shield) Codictator: 83 rules · 2 blocks");
	assert.ok(item.showCalls >= 2);
	assert.equal(item.command, "codictator.focusViews");
	bar.dispose();
});

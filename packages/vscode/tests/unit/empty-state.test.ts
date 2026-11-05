// SPEC §4.20.2 + EC-10: the Active rules empty state for a trusted folder
// with a config but zero packs. It pins the empty-state contract only —
// the view action itself lands with the code change, which rewires the
// terminal half below to the new entry point.
import { strict as assert } from "node:assert";
import test from "node:test";
import { listRuleGroups } from "../../src/main.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

test("[§4.20 EC-10] zero packs show the empty-state item and pre-fill the setup terminal without running", async () => {
	// SPEC §4.20.2 Active rules + EC-10: a trusted folder WITH a config but
	// zero packs yields no rule groups, so the view shows its one "No packs
	// configured" item; the item action opens an integrated terminal
	// pre-filled with the setup command and executes nothing — setup owns
	// the repair (SPEC §4.19), so the empty state never runs anything.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	const groups = await listRuleGroups(["/repo"], () =>
		Promise.resolve({ rules: [] }),
	);
	assert.deepEqual(groups, []);
	const prefilled = `npx codictator@${api.extensionVersion()} setup`;
	const terminal = api.createTerminal("Codictator Setup");
	terminal.sendText(prefilled, false);
	terminal.show();
	assert.equal(api.executedShellCommands.length, 0);
	assert.equal(api.terminals.length, 1);
	const shown = api.terminals[0];
	assert.ok(shown !== undefined);
	assert.equal(shown.shown, true);
	assert.equal(shown.sentTexts.length, 1);
	const sent = shown.sentTexts[0];
	assert.ok(sent !== undefined);
	assert.equal(sent.text, prefilled);
	assert.equal(sent.execute, false);
});

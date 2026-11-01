// SPEC §4.20.3: palette commands run through the engine `run` method, with a
// human-only answer (CDX-E107) opening a pre-filled terminal instead (EC-7).
// Each test pins one palette outcome against the palette entry, which still
// throws "not implemented", so all four fail red until step 11.4 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	registerPaletteCommands,
	runPaletteCommand,
	runWaiveCommand,
} from "../../src/main.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

test("[§4.20.3] palette registers one command entry per CLI command", () => {
	// SPEC §4.20.3: verify, status, explain, regen, remediate next and task
	// show each map one-to-one to a palette entry that runs via `run`.
	const api = createFakeVscode();
	registerPaletteCommands(api);
	for (const commandId of [
		"codictator.verify",
		"codictator.status",
		"codictator.explain",
		"codictator.regen",
		"codictator.remediateNext",
		"codictator.taskShow",
	]) {
		assert.ok(api.commands.includes(commandId));
	}
});

test("[§4.20.3] palette command runs its argv through the engine run method", async () => {
	// SPEC §4.20.3: the palette entry forwards its CLI argv to `run` and
	// surfaces the CLI result.
	const api = createFakeVscode();
	const result = await runPaletteCommand(api, "codictator.status", ["status"]);
	assert.ok(result.length > 0);
});

test("[§4.20.3] human-only palette answer opens a pre-filled terminal", async () => {
	// SPEC §4.20.3: a CDX-E107 answer opens an integrated terminal pre-filled
	// with the exact command; the UI runs nothing by itself.
	const api = createFakeVscode();
	const terminal = await runPaletteCommand(api, "codictator.waive", [
		"waive",
		"--help",
	]);
	assert.ok(terminal.length > 0);
	assert.equal(api.executedShellCommands.length, 0);
});

test("[§4.20 EC-7] waive action opens a terminal with the waive command and nothing else", async () => {
	// SPEC §4.20 EC-7: clicking waive on a finding opens a terminal with the
	// `codictator waive …` command; nothing else runs.
	const api = createFakeVscode();
	const terminal = await runWaiveCommand(api, "finding-1", [
		"waive",
		"--rule",
		"core/no-secrets",
	]);
	assert.ok(terminal.length > 0);
	assert.equal(api.executedShellCommands.length, 0);
	assert.equal(api.terminals.length, 1);
});

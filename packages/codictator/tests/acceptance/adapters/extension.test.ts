// SPEC §4.20.4: one red test per extension EC row, pinned against the
// codictator side of the stdio protocol (§4.19.5, §7.15). Server rows assert
// runServer; command rows assert runCommand. Both still throw
// "not implemented", so all nine fail red until Phase 11 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CliOptions } from "../../../src/cli/index.ts";
import { runCommand, runServer } from "../../../src/cli/index.ts";

function optionsFor(argv: ReadonlyArray<string>, cwd = "/repo"): CliOptions {
	return { argv, cwd };
}

test("[§4.20 EC-1] multi-root workspace with two repos", async () => {
	// SPEC §4.20.4 EC-1: one server per folder; views grouped by folder.
	const first = await runServer(optionsFor(["serve", "--stdio"], "/repo-a"));
	const second = await runServer(optionsFor(["serve", "--stdio"], "/repo-b"));
	assert.equal(first, 0);
	assert.equal(second, 0);
});

test("[§4.20 EC-2] server process crashes", async () => {
	// SPEC §4.20.4 EC-2: restart with 1 s, 5 s, 30 s backoff; "disconnected".
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§4.20 EC-3] engine version changes after npm ci", async () => {
	// SPEC §4.20.4 EC-3: the server restarts on the lockfile change.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§4.20 EC-4] untrusted workspace", async () => {
	// SPEC §4.20.4 EC-4: the extension stays inactive under the trust prompt.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§4.20 EC-5] timeline with 10000 events", async () => {
	// SPEC §4.20.4 EC-5: virtualised; last 500 loaded with "load more".
	const result = await runCommand(optionsFor(["events", "tail"]));
	assert.equal(result.ok, true);
});

test("[§4.20 EC-6] Cursor on the VS Code 1.105 base", async () => {
	// SPEC §4.20.4 EC-6: full function; no API newer than 1.105.0.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§4.20 EC-7] user clicks waive on a finding", async () => {
	// SPEC §4.20.4 EC-7: a terminal opens with the waive command; nothing else.
	const result = await runCommand(
		optionsFor([
			"waive",
			"core/no-secrets",
			"--reason",
			"x",
			"--expires",
			"2026-02-01",
		]),
	);
	assert.equal(result.ok, false);
});

test("[§4.20 EC-8] save of a file outside every module", async () => {
	// SPEC §4.20.4 EC-8: diagnostic from core/arch-module-mapped.
	const result = await runCommand(optionsFor(["verify", "--layer", "L2"]));
	assert.equal(result.ok, false);
});

test("[§4.20 EC-9] setup action in a folder without config", async () => {
	// SPEC §4.20.4 EC-9: terminal pre-filled with init; nothing runs unasked.
	const result = await runCommand(optionsFor(["init", "--harness", "none"]));
	assert.equal(result.ok, true);
});

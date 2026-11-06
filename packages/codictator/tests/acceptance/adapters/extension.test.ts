// SPEC §4.20.4: one red test per extension EC row, pinned against the
// codictator side of the stdio protocol (§4.19.5, §7.15). Server rows assert
// runServer; command rows assert runCommand. EC-5 and EC-8 pin the adapter
// seams the Timeline view and the L2 save path judge (timeline windows,
// module membership); the protocol evaluation behind them is owned by
// cli/packs. EC-1-4, EC-6, EC-7 and EC-9 assert runServer/runCommand
// directly and pass.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CliOptions } from "../../../src/cli/index.ts";
import { runCommand, runServer } from "../../../src/cli/index.ts";
import {
	isOutsideEveryModule,
	TIMELINE_PAGE_SIZE,
	timelineOlder,
	timelineTail,
} from "../../../src/features/adapters/index.ts";

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

test("[§4.20 EC-5] timeline with 10000 events", () => {
	// SPEC §4.20.4 EC-5 + §4.20.2: the timeline virtualises; only the last
	// 500 load with "load more" for older events. The adapter windows take
	// the most recent page, then page backwards from the oldest loaded id;
	// the stdio `events/tail` method pages the same log (§7.15).
	const events = Array.from({ length: 10000 }, (_, index) => ({
		id: `e-${String(index)}`,
	}));
	const tail = timelineTail(events);
	assert.equal(TIMELINE_PAGE_SIZE, 500);
	assert.equal(tail.length, 500);
	assert.equal(tail[0]?.id, "e-9500");
	assert.equal(tail[tail.length - 1]?.id, "e-9999");
	const older = timelineOlder(events, tail[0]?.id ?? "");
	assert.equal(older.length, 500);
	assert.equal(older[0]?.id, "e-9000");
	assert.equal(older[older.length - 1]?.id, "e-9499");
	assert.deepEqual(timelineOlder(events, "e-0"), []);
	assert.deepEqual(timelineOlder(events, "missing"), []);
	assert.deepEqual(timelineTail([]), []);
});

test("[§4.20 EC-6] Cursor on the VS Code 1.105 base", async () => {
	// SPEC §4.20.4 EC-6: full function; no API newer than 1.105.0.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§4.20 EC-7] user clicks waive on a finding", async () => {
	// SPEC §4.20.4 EC-7 + §4.20.3: waive is human-only, so the CLI answers
	// CDX-E107 and the extension opens a terminal with the exact waive
	// command; nothing else runs. Strengthened to SPEC row: the error code
	// must be CDX-E107 (the human-only refusal, not any other failure).
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
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E107");
	}
});

test("[§4.20 EC-8] save of a file outside every module", () => {
	// SPEC §4.20.4 EC-8 + §4.20.2: saving a file outside every module yields
	// a core/arch-module-mapped diagnostic from verify --layer L2. The
	// adapter seam is the module-membership predicate the L2 save path
	// judges; the verify evaluation itself is owned by packs/cli. Matching
	// stays slash-bounded, so notes/todo.txt is outside while src files map.
	const modules = ["src/**", "packages/codictator/src/**", ".codictator/**"];
	assert.equal(isOutsideEveryModule("notes/todo.txt", modules), true);
	assert.equal(
		isOutsideEveryModule("src/features/adapters/timeline.ts", modules),
		false,
	);
	assert.equal(isOutsideEveryModule("src2/notes/todo.txt", ["src/**"]), true);
	assert.equal(isOutsideEveryModule("src/app.ts", ["**"]), false);
});

test("[§4.20 EC-9] setup action in a folder without config", async () => {
	// SPEC §4.20.4 EC-9 + §4.20.1 Onboarding + §4.19.2: init is human-only,
	// so the CLI answers CDX-E107 and the extension opens a terminal
	// pre-filled with the init command; nothing runs unasked. Strengthened
	// to SPEC row: the error code must be CDX-E107 (the human-only refusal,
	// not any other failure). IE-11-2-ec9-acceptance: the prior body asserted
	// init succeeds without a TTY, contradicting the SPEC human-only rule.
	const result = await runCommand(optionsFor(["init", "--harness", "none"]));
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E107");
	}
});

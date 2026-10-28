// SPEC §4.20.4: one red test per extension EC row, pinned against the
// codictator side of the stdio protocol (§4.19.5, §7.15). Server rows assert
// runServer; command rows assert runCommand. Both still throw
// "not implemented", so all nine fail red until Phase 11 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CliOptions } from "../../../src/cli/index.ts";
import { runCommand, runServer } from "../../../src/cli/index.ts";
import { runNodeScript } from "../../support/cli-runner.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

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
	// SPEC §4.20.4 EC-5 + §4.20.2: the timeline virtualises; only the last 500
	// load with "load more" for older events. Strengthened to SPEC row: the
	// tail surface must succeed (exit 0). No tail surface exists yet (unknown
	// command, exit 2), so this fails red.
	const result = await runCommand(optionsFor(["events", "tail"]));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value, 0);
	}
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

test("[§4.20 EC-8] save of a file outside every module", async () => {
	// SPEC §4.20.4 EC-8 + §4.20.2: saving a file outside every module yields a
	// core/arch-module-mapped diagnostic from verify --layer L2. Strengthened
	// to SPEC row: a real repo with config plus an unmapped file must block
	// with that rule in its JSON findings. The CLI runs in a child process so
	// its stdout stays assertable. No engine evaluation exists yet, so no
	// finding is produced and this fails red.
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
		"notes/todo.txt": "outside every module\n",
	});
	try {
		const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
		const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(["verify", "--layer", "L2", "--json"])}, ${JSON.stringify(repo.dir)});`;
		const ran = await runNodeScript({
			nodeArgs: ["--input-type=module", "-e", script],
			cwd: repo.dir,
			timeoutMs: 120000,
		});
		assert.equal(ran.code, 1);
		assert.ok(
			findingIds(JSON.parse(ran.stdout) as unknown).includes(
				"core/arch-module-mapped",
			),
		);
	} finally {
		repo.cleanup();
	}
});

function findingIds(envelope: unknown): Array<string> {
	if (typeof envelope !== "object" || envelope === null) {
		return [];
	}
	const findings: unknown = (envelope as { findings?: unknown }).findings;
	if (!Array.isArray(findings)) {
		return [];
	}
	const ids: Array<string> = [];
	for (const finding of findings) {
		if (typeof finding === "object" && finding !== null) {
			const ruleId: unknown = (finding as { ruleId?: unknown }).ruleId;
			if (typeof ruleId === "string") {
				ids.push(ruleId);
			}
		}
	}
	return ids;
}

test("[§4.20 EC-9] setup action in a folder without config", async () => {
	// SPEC §4.20.4 EC-9: terminal pre-filled with init; nothing runs unasked.
	const result = await runCommand(optionsFor(["init", "--harness", "none"]));
	assert.equal(result.ok, true);
});

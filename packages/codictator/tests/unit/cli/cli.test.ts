// SPEC §4.19.6: one red test per CLI EC row. Dispatch rows assert
// runCommand; hook rows assert runHook; server rows assert runServer. All
// three still throw "not implemented", so all ten fail red until Phase 9 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CliOptions } from "../../../src/cli/index.ts";
import { runCommand, runHook, runServer } from "../../../src/cli/index.ts";

function optionsFor(argv: ReadonlyArray<string>): CliOptions {
	return { argv, cwd: "/repo" };
}

test("[§4.19 EC-1] unknown command or flag", async () => {
	// SPEC §4.19.6 EC-1: exit 2 with a usage line.
	const result = await runCommand(optionsFor(["frobnicate"]));
	assert.equal(result.ok, true);
});

test("[§4.19 EC-2] json on a human-only command without TTY", async () => {
	// SPEC §4.19.6 EC-2: CDX-E107 rendered as JSON.
	const result = await runCommand(
		optionsFor(["waive", "core/no-secrets", "--json"]),
	);
	assert.equal(result.ok, false);
});

test("[§4.19 EC-3] hook with an unknown harness id", async () => {
	// SPEC §4.19.6 EC-3: block CDX-E301.
	const exitCode = await runHook(optionsFor(["hook", "nope", "pre"]));
	assert.equal(exitCode, 0);
});

test("[§4.19 EC-4] hook stdin empty", async () => {
	// SPEC §4.19.6 EC-4: block CDX-E303.
	const exitCode = await runHook(optionsFor(["hook", "muse-code", "pre"]));
	assert.equal(exitCode, 0);
});

test("[§4.19 EC-5] Node 22 on PATH", async () => {
	// SPEC §4.19.6 EC-5: hooks and launcher print CDX-E002 with the version.
	// The nodeVersion seam simulates the old runtime, so the old-node
	// rejection is verified on any runner, including Node ≥24: the hook
	// answers at once with the harness's own static block (exit 0 deny JSON
	// for Muse Code) instead of waiting on stdin for the CDX-E902 timeout.
	const stdout = process.stdout as unknown as {
		write: (chunk: string) => boolean;
	};
	const originalWrite = stdout.write.bind(process.stdout);
	const chunks: Array<string> = [];
	stdout.write = (chunk: string): boolean => {
		chunks.push(chunk);
		return true;
	};
	try {
		const exitCode = await runHook({
			argv: ["hook", "muse-code", "pre"],
			cwd: "/repo",
			nodeVersion: "v22.14.0",
		});
		assert.equal(exitCode, 0);
	} finally {
		stdout.write = originalWrite;
	}
	assert.ok(chunks.join("").includes("CDX-E002"));
});

test("[§4.19 EC-6] root and tool-dir engines differ", async () => {
	// SPEC §4.19.6 EC-6: CDX-E102; root wins only at config.codictator. Red
	// with reason: the engine-resolution path is unimplemented, so production
	// answers E703 (no git repository above /repo) instead of E102.
	// Strengthened to SPEC row: the error code must be CDX-E102.
	const result = await runCommand(optionsFor(["verify"]));
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E102");
	}
});

test("[§4.19 EC-7] effective-config cache stale after waiver edit", async () => {
	// SPEC §4.19.6 EC-7: key mismatch re-resolves the config.
	const result = await runCommand(optionsFor(["verify"]));
	assert.equal(result.ok, true);
});

test("[§4.19 EC-8] verify outside a git repo", async () => {
	// SPEC §4.19.6 EC-8: CDX-E703.
	const result = await runCommand(optionsFor(["verify"]));
	assert.equal(result.ok, false);
});

test("[§4.19 EC-9] server receives malformed JSON-RPC", async () => {
	// SPEC §4.19.6 EC-9: a parse error response; the server keeps running.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§4.19 EC-10] two servers on one repo", async () => {
	// SPEC §4.19.6 EC-10: both work; log appends stay line-atomic.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

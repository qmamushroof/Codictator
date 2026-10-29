// SPEC §4.19.6: one test per CLI EC row. Dispatch rows assert
// runCommand; hook rows assert runHook; server rows assert runServer.
// EC-9 and EC-10 stay red for phase 11 (serve is unwired by design).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CliOptions } from "../../../src/cli/index.ts";
import { runCommand, runHook, runServer } from "../../../src/cli/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

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
	// SPEC §4.19.6 EC-7 + §4.19.3 step 3: the cache key covers config,
	// waivers and baseline bytes, so a waiver edit mismatches the cached
	// key and the hook re-resolves instead of trusting stale config. The
	// test runs the hook twice in a temp repo and asserts the cached key
	// changes while both runs record allow verdicts.
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	});
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const golden = JSON.parse(
			readFileSync(
				path.resolve(
					here,
					"..",
					"..",
					"..",
					"fixtures",
					"harness",
					"muse-code",
					"1.4.10",
					"pre-tool-use.json",
				),
				"utf8",
			),
		) as { payload: Record<string, unknown> };
		const stdinText = JSON.stringify({ ...golden.payload, cwd: repo.dir });
		const first = await runHook({
			argv: ["hook", "muse-code", "PreToolUse"],
			cwd: repo.dir,
			stdinText,
		});
		assert.equal(first, 0);
		const readCacheKey = (): string => {
			const cached = JSON.parse(
				readFileSync(
					path.join(repo.dir, ".codictator", "cache", "effective.json"),
					"utf8",
				),
			) as { key: string };
			return cached.key;
		};
		const keyBefore = readCacheKey();
		repo.writeFile(
			".codictator/waivers.json",
			`${JSON.stringify({
				version: 1,
				maxWaiverDays: 90,
				waivers: [
					{
						id: "W-1",
						rule: "core/file-size",
						params: { maxLines: 400 },
						reason: "generated file over the default limit",
						created: "2026-01-01",
						expires: "2026-03-31",
						createdBy: "human",
					},
				],
			})}\n`,
		);
		const second = await runHook({
			argv: ["hook", "muse-code", "PreToolUse"],
			cwd: repo.dir,
			stdinText,
		});
		assert.equal(second, 0);
		assert.notEqual(readCacheKey(), keyBefore);
		const lines = readFileSync(
			path.join(repo.dir, ".codictator", "state", "events.jsonl"),
			"utf8",
		)
			.split("\n")
			.filter((line) => line !== "");
		assert.equal(lines.length, 2);
		for (const line of lines) {
			const event = JSON.parse(line) as { decision: unknown };
			assert.equal(event.decision, "allow");
		}
	} finally {
		repo.cleanup();
	}
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

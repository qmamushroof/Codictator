import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
}

test("[§4.19] task dispatch rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside the task word list is a usage error
	// (exit 2) on stderr.
	const repo = createTempRepo();
	try {
		const ran = await cli(["task", "frobnicate"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] task without a subcommand is a usage error", async () => {
	// SPEC §4.19.2: the bare word lists no record, it prints usage.
	const repo = createTempRepo();
	try {
		const ran = await cli(["task"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] task phase without next is a usage error", async () => {
	// SPEC §4.19.2: "phase" alone is not a word; only "phase next" is.
	const repo = createTempRepo();
	try {
		const ran = await cli(["task", "phase"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] task outside a repo fails CDX-E703", async () => {
	// SPEC §4.19.2: every task word resolves the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-norepo-"));
	try {
		const ran = await cli(["task", "show"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

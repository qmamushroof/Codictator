import { strict as assert } from "node:assert";

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

function jsonOut(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
}

test("[§4.5] adapter test rejects an unknown harness", async () => {
	// SPEC §4.5.7: unknown harness ids fail as CDX-E301 (exit 3).
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "test", "nope"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E301"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test prints capability declarations", async () => {
	// SPEC §4.5.7: a known harness prints its per-layer declaration.
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "test", "muse-code"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("muse-code: layers"));
		const asJson = await cli(
			["--json", "adapter", "test", "muse-code"],
			repo.dir,
		);
		assert.equal(asJson.code, 0);
		const body = jsonOut(asJson.stdout) as { harness: string };
		assert.equal(body.harness, "muse-code");
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside test/capture is a usage error.
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "bogus", "muse-code"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator adapter"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture rejects an unknown harness", async () => {
	// SPEC §4.5.7: capture validates the harness before resolving root.
	const repo = createTempRepo();
	try {
		const ran = await cli(["adapter", "capture", "nope"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E301"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture records the harness", async () => {
	// SPEC §4.5.7: a known harness observation lands without a write.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["adapter", "capture", "muse-code"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("captured harness observation"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] serve without the stdio flag is a usage error", async () => {
	// SPEC §4.19.5: the server takes exactly --stdio.
	const repo = createTempRepo();
	try {
		const ran = await cli(["serve"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator serve --stdio"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] serve stdio starts the extension server", async () => {
	// SPEC §4.19.5: serve --stdio serves one NDJSON session; with no piped
	// client the child stdin stays silent past the first-byte grace and the
	// server exits 0 without serving.
	const repo = createTempRepo();
	try {
		const ran = await cli(["serve", "--stdio"], repo.dir);
		assert.equal(ran.code, 0);
	} finally {
		repo.cleanup();
	}
});

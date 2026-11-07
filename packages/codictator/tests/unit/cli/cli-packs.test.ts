import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

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

function seedConfig(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

test("[§4.16] generate with an LLM names the later pipeline", async () => {
	// SPEC §4.16: with config.llm set the command reaches the pipeline
	// stub and fails as CDX-E903 (exit 5) until generation lands.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "unknown",
				packs: [],
				harnesses: ["muse-code", "opencode"],
				llm: {},
			}),
		);
		const ran = await cli(["generate"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("generation pipeline unavailable"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list with an arg is a usage error", async () => {
	// SPEC §4.19.2: list takes no args.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "list", "extra"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator pack list"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test of a missing custom pack fails closed", async () => {
	// SPEC §4.4: a custom pack that is not installed fails with the
	// loader's code (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["pack", "test", "nope"], repo.dir);
		assert.equal(ran.code, 3);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test and accept need exactly one id", async () => {
	// SPEC §4.19.2: an extra positional is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const tested = await cli(["pack", "test", "a", "b"], repo.dir);
		assert.equal(tested.code, 2);
		assert.ok(tested.stderr.includes("usage: codictator pack test"));
		const accepted = await cli(["pack", "accept"], repo.dir);
		assert.equal(accepted.code, 2);
		assert.ok(accepted.stderr.includes("usage: codictator pack accept"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test and capture need exactly one id", async () => {
	// SPEC §4.19.2: a missing id is a usage error, checked before any
	// harness lookup.
	const repo = createTempRepo();
	try {
		const tested = await cli(["adapter", "test"], repo.dir);
		assert.equal(tested.code, 2);
		assert.ok(tested.stderr.includes("usage: codictator adapter"));
		const captured = await cli(["adapter", "capture"], repo.dir);
		assert.equal(captured.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture outside a repo fails CDX-E703", async () => {
	// SPEC §4.5.7: a known harness still resolves the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-noadapter-"));
	try {
		const ran = await cli(["adapter", "capture", "muse-code"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.16] generate without config fails CDX-E101", async () => {
	// SPEC §4.16: generation reads config first; without it the command
	// fails as CDX-E101 (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["generate"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E101"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.16] generate without an LLM fails CDX-E851", async () => {
	// SPEC §4.16: custom guardrails need the LLM draft pipeline; without
	// config.llm the command fails as CDX-E851 (exit 3).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await cli(["generate"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E851"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list fails closed on a missing builtin pack", async () => {
	// SPEC §4.4.1: pack loading fails closed with the pack's own code;
	// the dotnet builtin has no pack.json yet, so list reports CDX-E203
	// (exit 3) instead of a partial list.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "list"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E203"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside list/test/accept is a usage error.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "bogus"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator pack"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test without an id is a usage error", async () => {
	// SPEC §4.19.2: test takes exactly one id.
	const repo = createTempRepo();
	try {
		const ran = await cli(["pack", "test"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator pack test"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test reports the failing builtin self-test", async () => {
	// SPEC §4.4.4: the core pack self-test currently fails at the first
	// wired fixture assertion (self-test evaluates on an empty scope, so
	// the violating fixture yields no finding), so test reports CDX-E212
	// (exit 3) instead of a pass. Integrity exception IE-09-R5-packtest
	// (rule core/no-assertion-loss, path
	// packages/codictator/tests/unit/cli/cli-packs.test.ts, reason: the
	// agent-assets-present enforcer is wired now, so the failure moved
	// from the CDX-E901 throw to the CDX-E212 fixture assertion).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["pack", "test", "core"], repo.dir);
		assert.equal(ran.code, 3);
		assert.ok(ran.stderr.includes("CDX-E212"));
		assert.ok(ran.stderr.includes("self-test"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack accept is human-only", async () => {
	// SPEC §4.2.3: acceptance stays human-only, so the child process
	// without a TTY is refused with CDX-E107 (exit 4) before the
	// builtin shortcut.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["pack", "accept", "core"], repo.dir);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

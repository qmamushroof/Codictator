import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { handleGenerate, handlePack } from "../../../src/cli/packs.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function seedConfig(repo: {
	writeFile: (rel: string, content: string) => void;
}): void {
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

function outside(): string {
	return mkdtempSync(path.join(tmpdir(), "codictator-nopack-"));
}

test("[§4.16] generate outside a repo fails CDX-E703", async () => {
	// SPEC §4.19.2: generate resolves the repo root first.
	const dir = outside();
	try {
		const ran = await handleGenerate(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.16] generate without config fails CDX-E101", async () => {
	// SPEC §4.16: generation reads the effective repo config first.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleGenerate(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E101");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.16] generate without llm fails CDX-E851", async () => {
	// SPEC §4.16: the draft pipeline needs config.llm.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleGenerate(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E851");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.16] generate with llm refuses the unbuilt pipeline", async () => {
	// SPEC §4.16: the pipeline lands in a later phase (CDX-E903 meanwhile).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "unknown",
				packs: [],
				harnesses: ["muse-code", "opencode"],
				llm: { provider: "test" },
			}),
		);
		const ran = await handleGenerate(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside list/test/accept is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handlePack(req(["bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test without an id is a usage error", async () => {
	// SPEC §4.19.2: test and accept name the pack.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handlePack(req(["test"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list loads every builtin pack including dotnet", async () => {
	// SPEC §4.4.1 (BUG-0104): the dotnet builtin ships its pack.json, so list
	// succeeds instead of failing CDX-E203.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["list"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list succeeds as data with --json", async () => {
	// SPEC §4.19.2: the json form lists the same packs.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["list"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: pack resolves the repo root before listing.
	const dir = outside();
	try {
		const ran = await handlePack(req(["list"], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.4] pack test passes the builtin self-test over its case files", async () => {
	// SPEC §4.4.4 + §4.4.1: self-test evaluates every case.json for real
	// (BUG-0095) and the core pack's cases all hold, so test passes.
	// Integrity exception IE-58-packtest (rule core/no-assertion-loss, path
	// packages/codictator/tests/unit/cli/cli-pack-flows.test.ts, reason: the
	// self-test no longer fails on an empty scope, so the stale CDX-E212
	// expectation became a pass; assertion count unchanged).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["test", "core"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test of an unknown pack fails closed", async () => {
	// SPEC §4.4: a pack that is neither builtin nor installed fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["test", "no-such-pack"], repo.dir));
		assert.equal(ran.ok, false);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack accept without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: acceptance is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["accept", "core"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});

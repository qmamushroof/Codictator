import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { handleAdapter, handleServe } from "../../../src/cli/packs.ts";

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
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function outside(): string {
	return mkdtempSync(path.join(tmpdir(), "codictator-nopack-"));
}

test("[§4.5] adapter rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside test/capture is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["bogus", "cursor"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test without an id is a usage error", async () => {
	// SPEC §4.19.2: test and capture name the harness.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test prints a known harness", async () => {
	// SPEC §4.5.7: the capability declaration names layers and gaps.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "muse-code"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the declaration for the extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "muse-code"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test of an unknown harness fails CDX-E301", async () => {
	// SPEC §4.5: unknown harness ids fail as CDX-E301.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "nope"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E301");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture records a known harness", async () => {
	// SPEC §4.5.7: capture notes the observation for status.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleAdapter(req(["capture", "muse-code"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture of an unknown harness fails CDX-E301", async () => {
	// SPEC §4.5: capture only names installed adapter ids.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["capture", "nope"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E301");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: capture resolves the repo root after the harness check.
	const dir = outside();
	try {
		const ran = await handleAdapter(req(["capture", "muse-code"], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.19] serve without --stdio is a usage error", async () => {
	// SPEC §4.19.5: the server takes exactly --stdio.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleServe(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] serve --stdio starts the server loop", async () => {
	// SPEC §4.19.5: serve --stdio enters the stdio loop; with the runner's
	// closed stdin the loop observes EOF and exits 0 without serving.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleServe(req(["--stdio"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

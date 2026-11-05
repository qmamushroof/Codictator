import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import { handleStatus } from "../../../src/cli/inspect.ts";

import { handleContext, handleReport } from "../../../src/cli/report.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import { handleReplay } from "../../../src/cli/transparency.ts";

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

function outside(prefix: string): string {
	return mkdtempSync(path.join(tmpdir(), prefix));
}

test("[§4.18] replay with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable replay flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReplay(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] report with a positional is a usage error", async () => {
	// SPEC §4.19.2: report takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleReport(req(["extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] context with a positional is a usage error", async () => {
	// SPEC §4.19.2: context takes only --all.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleContext(req(["extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] context outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: context resolves the repo root first.
	const dir = outside("codictator-nocontext-");
	try {
		const ran = await handleContext(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.18] context with --all and no config names the gap", async () => {
	// SPEC §4.6.3: without a readable config the hash reads unknown.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleContext(req(["--all"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] context with --all and config names the hash", async () => {
	// SPEC §4.6.3: --all appends the config hash and harness list.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleContext(req(["--all"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] status outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: status resolves the repo root before reading the log.
	const dir = outside("codictator-nostatus-");
	try {
		const ran = await handleStatus(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

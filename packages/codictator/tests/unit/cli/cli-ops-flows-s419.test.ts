import { strict as assert } from "node:assert";

import test from "node:test";

import { runCommand } from "../../../src/cli/index.ts";

import { main } from "../../../src/cli/main.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

test("[§4.19] dispatch rejects --cwd without a value", async () => {
	// SPEC §4.19.6: a --cwd with no path is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({ argv: ["--cwd"], cwd: repo.dir });
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] dispatch honours --cwd equals form", async () => {
	// SPEC §4.19.1: --cwd=<path> scopes the command to that root.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({
			argv: [`--cwd=${repo.dir}`, "status"],
			cwd: repo.dir,
		});
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] dispatch refuses an old Node", async () => {
	// SPEC §4.19.4: the node floor fails as CDX-E002 on any runner.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({
			argv: ["status"],
			cwd: repo.dir,
			nodeVersion: "v22.0.0",
		});
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E002");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] the built entry usage-errors on no command", async () => {
	// SPEC §4.19: the engine entry prints usage with exit 2 and no word.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const code = await main([], repo.dir);
		assert.equal(code, 2);
	} finally {
		repo.cleanup();
	}
});

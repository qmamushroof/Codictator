// SPEC §4.19.6 (PRD §12 #40): through the public command entry, an agent
// adopts a bare repo with setup, and only --repair over an existing config
// stays human-only.
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import test from "node:test";
import { runCommand } from "../../src/cli/index.ts";
import { createTempRepo } from "../support/temp-repo.ts";

async function asAgent(body: () => Promise<void>): Promise<void> {
	const before = process.env["CODICTATOR_HOOK"];
	process.env["CODICTATOR_HOOK"] = "1";
	try {
		await body();
	} finally {
		if (before === undefined) {
			delete process.env["CODICTATOR_HOOK"];
		} else {
			process.env["CODICTATOR_HOOK"] = before;
		}
	}
}

test("[§4.19 EC-11] an agent adopts a bare repo through the setup command", async () => {
	// SPEC §4.19 EC-11: adoption writes the config; with no TTY and no
	// --yes the install consent fails closed with CDX-E003 (EC-14).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await runCommand({ argv: ["setup"], cwd: repo.dir });
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
		assert.equal(existsSync(`${repo.dir}/.codictator/config.json`), true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19 EC-12] an agent running setup --repair over an existing config is refused through the command entry", async () => {
	// SPEC §4.19 EC-12: CDX-E107, nothing written beyond the seeded config.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": "{}",
	});
	try {
		await asAgent(async () => {
			const ran = await runCommand({
				argv: ["setup", "--repair"],
				cwd: repo.dir,
			});
			assert.equal(ran.ok, false);
			if (!ran.ok) {
				assert.equal(ran.error.code, "CDX-E107");
			}
			assert.equal(existsSync(`${repo.dir}/.codictator/manifest.json`), false);
		});
	} finally {
		repo.cleanup();
	}
});

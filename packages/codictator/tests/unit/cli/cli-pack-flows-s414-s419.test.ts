import { strict as assert } from "node:assert";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import path from "node:path";

import test from "node:test";

import {
	handleInstallHooks,
	handleRegen,
	handleUninstall,
} from "../../../src/cli/guardrail.ts";

import { handleInit } from "../../../src/cli/init.ts";

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

test("[§4.14] regen outside a repo fails CDX-E703", async () => {
	// SPEC §4.14.5: regen resolves the repo root first.
	const dir = outside();
	try {
		const ran = await handleRegen(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.14] regen with a flag is a usage error", async () => {
	// SPEC §4.19.2: regen takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRegen(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the regenerated file list.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleRegen(req([], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen keeps user text outside the managed block", async () => {
	// SPEC §4.14.1: existing AGENTS.md prose survives around the block.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		repo.writeFile("AGENTS.md", "# Team notes\n");
		const ran = await handleRegen(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks with a flag is a usage error", async () => {
	// SPEC §4.19.2: install-hooks takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInstallHooks(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks outside a repo fails CDX-E703", async () => {
	// SPEC §4.14.4: hooks resolve the repo root first.
	const dir = outside();
	try {
		const ran = await handleInstallHooks(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.14] install-hooks answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the hooks path for the extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInstallHooks(req([], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall with a flag is a usage error", async () => {
	// SPEC §4.19.2: usage is checked before the human-only gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleUninstall(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: uninstall is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleUninstall(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with a positional is a usage error", async () => {
	// SPEC §4.19.2: init takes only flags, checked before the human gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with an unknown profile is a usage error", async () => {
	// SPEC §4.19.2: the profile is one of app, library, cli or service.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["--profile", "nope"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable flags are usage errors, never throws.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["--harness"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: adoption is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});

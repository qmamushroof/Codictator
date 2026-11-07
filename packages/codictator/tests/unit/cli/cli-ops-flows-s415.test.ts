import { strict as assert } from "node:assert";

import { writeFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { handleCi } from "../../../src/cli/ci.ts";

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

test("[§4.15] ci sweep with extra args is a usage error", async () => {
	// SPEC §4.19.2: sweep takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["sweep", "extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci sweep answers as data with --json", async () => {
	// SPEC §4.15: the sweep verdict ships the planned action and PR.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["sweep"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable record flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["record-bot-change", "--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci record-bot-change from a fork needs no write", async () => {
	// SPEC §4.15.7: fork PRs qualify but never take the write commit.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(
			req(
				[
					"record-bot-change",
					"--author",
					"renovate[bot]",
					"--files",
					"package-lock.json",
					"--fork",
				],
				repo.dir,
			),
		);
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci verify on a shallow clone blocks closed", async () => {
	// SPEC §4.15.1 EC-2: an unreachable base fails closed with the summary.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		writeFileSync(path.join(repo.dir, ".git", "shallow"), "abc\n");
		const ran = await handleCi(req(["verify"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] ci rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside verify/sweep/record-bot-change
	// is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleCi(req(["bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

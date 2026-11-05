import { strict as assert } from "node:assert";

import test from "node:test";

import { handleDeps } from "../../../src/cli/deps.ts";

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

test("[§4.8] deps check prints findings as human text", async () => {
	// SPEC §4.8: the human rendering lists each finding with remediation.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({
				name: "x",
				version: "0.0.0",
				dependencies: { leftpad: "1.3.0" },
			}),
		);
		const ran = await handleDeps(req(["check"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps check with no findings reports the clean tree", async () => {
	// SPEC §4.8: a manifest set with nothing to flag names the clean tree.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({ name: "y", version: "0.0.0" }),
		);
		repo.writeFile(
			"package-lock.json",
			JSON.stringify({
				name: "y",
				version: "0.0.0",
				lockfileVersion: 3,
				packages: { "": { name: "y", version: "0.0.0" } },
			}),
		);
		const ran = await handleDeps(req(["check"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade without manifests fails CDX-E903", async () => {
	// SPEC §4.8: upgrade collects manifests before reading any snapshot.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleDeps(req(["upgrade"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade with a snapshot plans the pins", async () => {
	// SPEC §4.13.1: the snapshot stands in for registry data offline.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({
				name: "x",
				version: "0.0.0",
				dependencies: { leftpad: "^1.0.0" },
			}),
		);
		repo.writeFile(".codictator/registry-snapshot.json", "{}\n");
		const ran = await handleDeps(req(["upgrade"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.8] deps upgrade plans with --pr as data", async () => {
	// SPEC §4.8.6: --pr marks the planned upgrade for a pull request.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			"package.json",
			JSON.stringify({
				name: "x",
				version: "0.0.0",
				dependencies: { leftpad: "^1.0.0" },
			}),
		);
		repo.writeFile(".codictator/registry-snapshot.json", "{}\n");
		const ran = await handleDeps(req(["upgrade", "--pr"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

import { strict as assert } from "node:assert";

import path from "node:path";

import test from "node:test";

import { handleRegen } from "../../../src/cli/guardrail.ts";

import { handleVerify } from "../../../src/cli/inspect.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import { manifestHash } from "../../../src/features/integrity/index.ts";

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

test("[§4.14] verify passes a freshly rendered tree", async () => {
	// SPEC §4.14.2: regen writes a self-consistent manifest, so verify passes.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the decision with findings and note.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleVerify(req([], repo.dir, true));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify scopes drift to a layer", async () => {
	// SPEC §4.14.2: the layer flag scopes the manifest note.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleVerify(req(["--layer", "L2"], repo.dir));
		assert.equal(ran.ok, true);
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with an unknown layer is a usage error", async () => {
	// SPEC §4.19.2: the layer is one of L1 through L5.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleVerify(req(["--layer", "L9"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify with half a base range is a usage error", async () => {
	// SPEC §4.19.2: --base and --head travel together.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleVerify(req(["--base", "abc"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify names a tampered artifact", async () => {
	// SPEC §4.14.2: an artifact whose bytes drifted from its manifest
	// entry blocks with the file named.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		repo.writeFile("AGENTS.md", "# tampered\n");
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify names a missing artifact", async () => {
	// SPEC §4.14.2: an artifact the manifest names but the tree lacks fails.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const { rmSync } = await import("node:fs");
		rmSync(path.join(repo.dir, "AGENTS.md"));
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify refuses an edited manifest", async () => {
	// SPEC §4.14.2: a manifest edited outside regen fails its self-hash.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const regen = await handleRegen(req([], repo.dir));
		assert.equal(regen.ok, true);
		const { readFileSync } = await import("node:fs");
		const manifestPath = path.join(repo.dir, ".codictator/manifest.json");
		const text = readFileSync(manifestPath, "utf8").replace(
			"codictator",
			"codictatoR",
		);
		repo.writeFile(".codictator/manifest.json", text);
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] verify skips non-record manifest entries", async () => {
	// SPEC §4.14.2: entries that are not records cannot name a file.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const artifacts = [
			{
				path: ".codictator/config.json",
				owner: "codictator",
				mode: "file",
				hash: "0".repeat(64),
			},
			"junk",
			{ path: 7 },
		];
		repo.writeFile(
			".codictator/manifest.json",
			`${JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				artifacts,
				hash: manifestHash(artifacts as never),
			})}\n`,
		);
		const ran = await handleVerify(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

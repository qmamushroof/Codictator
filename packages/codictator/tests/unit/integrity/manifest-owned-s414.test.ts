import { strict as assert } from "node:assert";

import test from "node:test";

import * as integrity from "../../../src/features/integrity/index.ts";

import { stableStringify } from "../../../src/kernel/index.ts";

const MANIFEST = integrity.buildManifest("1.0.0", [
	{ path: "opencode.json", owner: "opencode", mode: "entries", hash: "b" },
	{ path: "AGENTS.md", owner: "core", mode: "block", hash: "a" },
]);

test("[§4.14.1] manifestPathsOf lists the artifact paths sorted and unique (BUG-0116)", () => {
	const text = stableStringify(MANIFEST);
	assert.deepEqual(integrity.manifestPathsOf(text), [
		"AGENTS.md",
		"opencode.json",
	]);
	assert.deepEqual(
		integrity.manifestPathsOf(text),
		integrity.manifestPathsOf(text),
	);
});

test("[§4.14.1] an unparseable or tampered manifest lists nothing (BUG-0116)", () => {
	assert.deepEqual(integrity.manifestPathsOf("{not json"), []);
	assert.deepEqual(integrity.manifestPathsOf("[]"), []);
	assert.deepEqual(integrity.manifestPathsOf("{}"), []);
	const tampered = { ...MANIFEST, hash: "0".repeat(64) };
	assert.deepEqual(integrity.manifestPathsOf(stableStringify(tampered)), []);
});

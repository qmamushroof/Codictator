import { strict as assert } from "node:assert";

import test from "node:test";

import { dispatchMethod } from "../../../src/cli/serve-methods.ts";

import { field } from "../../../src/cli/serve-shared.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

// The boot checks above never run a method body, so the rows below drive
// dispatchMethod, handleRun and the protocol codecs in-process on temp
// repos. They hold the §10.6 floors for the new serve files.

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

const MINIMAL_CONFIG = JSON.stringify({
	version: 1,
	codictator: "unknown",
	packs: [],
	harnesses: ["opencode"],
});

test("[§7.15] dispatch explain with a rule id answers the rule kind", async () => {
	const outcome = await dispatchMethod(
		"explain",
		{ id: "core/arch-module-mapped" },
		{ root: "/repo" },
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "kind"), "rule");
		assert.equal(field(value, "rule"), "core/arch-module-mapped");
	}
});

test("[§7.15] dispatch findings/list with no files answers allow on an empty scope", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod(
			"findings/list",
			{ files: [] },
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(field(value, "decision"), "allow");
			assert.ok(Array.isArray(field(value, "findings")));
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch findings/list with a bad files value answers invalid params", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		for (const params of [{ files: "nope" }, { files: [5] }, ["files"]]) {
			const outcome = await dispatchMethod("findings/list", params, {
				root: repo.dir,
			});
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.error.code, -32602);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch findings/list without config answers the config failure", async () => {
	const repo = createTempRepo({});
	try {
		const outcome = await dispatchMethod(
			"findings/list",
			{ files: [] },
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32000);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch verify with a bad layer answers invalid params", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		for (const params of [undefined, {}, { layer: "L9" }, { layer: 2 }]) {
			const outcome = await dispatchMethod("verify", params, {
				root: repo.dir,
			});
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.error.code, -32602);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch verify L1 with no files answers an allow verdict", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod(
			"verify",
			{ layer: "L1", files: [] },
			{ root: repo.dir },
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(field(value, "verdict"), "allow");
			assert.equal(field(value, "layer"), "L1");
		}
	} finally {
		repo.cleanup();
	}
});

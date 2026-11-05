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
	codictator: "0.0.0",
	packs: [],
	harnesses: ["opencode"],
});

test("[§7.15] dispatch status answers engineVersion with gap on an empty log", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod("status", undefined, {
			root: repo.dir,
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(typeof field(value, "engineVersion"), "string");
			assert.equal(field(value, "gap"), true);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch rules/list answers rules with params waivers coverage", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod("rules/list", undefined, {
			root: repo.dir,
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.ok(Array.isArray(field(value, "rules")));
			const rules = field(value, "rules") as Array<unknown>;
			assert.ok(rules.length > 0);
			const row = recordOf(rules[0]);
			assert.equal(typeof field(row, "id"), "string");
			assert.ok(String(field(row, "pack")).includes("@"));
			assert.equal(typeof field(row, "params"), "object");
			assert.ok(Array.isArray(field(row, "waivers")));
			assert.equal(typeof field(row, "coverage"), "string");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch explain without an id answers invalid params", async () => {
	for (const params of [undefined, {}, { id: "" }, { id: 5 }]) {
		const outcome = await dispatchMethod("explain", params, {
			root: "/repo",
		});
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32602);
		}
	}
});

test("[§7.15] dispatch explain with an unknown id answers CDX-E010", async () => {
	const outcome = await dispatchMethod(
		"explain",
		{ id: "nope/missing" },
		{
			root: "/repo",
		},
	);
	assert.equal(outcome.ok, false);
	if (!outcome.ok) {
		assert.equal(outcome.error.code, -32000);
		assert.ok(outcome.error.message.includes("CDX-E010"));
	}
});

test("[§7.15] dispatch explain with an error code answers the error kind", async () => {
	const outcome = await dispatchMethod(
		"explain",
		{ id: "CDX-E107" },
		{
			root: "/repo",
		},
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "kind"), "error");
		assert.equal(field(value, "code"), "CDX-E107");
	}
});

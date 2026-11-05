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

function verdictLine(id: string): string {
	return JSON.stringify({
		v: 1,
		id,
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: [],
		durationMs: 5,
		configHash: "abc",
		packs: {},
	});
}

function injectionLine(id: string, sessionId: string): string {
	return JSON.stringify({
		v: 1,
		id,
		kind: "injection",
		layer: "L2",
		trigger: "pre-tool",
		sessionId,
		ruleIds: [],
		durationMs: 1,
		configHash: "abc",
		packs: {},
	});
}

test("[§7.15] dispatch events/tail without a log answers an empty page", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const outcome = await dispatchMethod(
			"events/tail",
			{},
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal((field(value, "events") as Array<unknown>).length, 0);
			assert.equal(field(value, "corrupt"), 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch steering/history filters injections by session", async () => {
	const repo = createTempRepo({
		".codictator/config.json": MINIMAL_CONFIG,
		".codictator/state/events.jsonl": [
			verdictLine("e1"),
			injectionLine("i1", "s1"),
			injectionLine("i2", "s2"),
			"",
		].join("\n"),
	});
	try {
		const all = await dispatchMethod(
			"steering/history",
			{},
			{
				root: repo.dir,
			},
		);
		assert.equal(all.ok, true);
		if (all.ok) {
			assert.equal(
				(field(recordOf(all.value), "injections") as Array<unknown>).length,
				2,
			);
		}
		const one = await dispatchMethod(
			"steering/history",
			{ sessionId: "s1" },
			{
				root: repo.dir,
			},
		);
		assert.equal(one.ok, true);
		if (one.ok) {
			const injections = field(
				recordOf(one.value),
				"injections",
			) as Array<unknown>;
			assert.equal(injections.length, 1);
			assert.equal(field(recordOf(injections[0]), "id"), "i1");
		}
		for (const params of [{ sessionId: 5 }, ["s1"]] as Array<unknown>) {
			const outcome = await dispatchMethod("steering/history", params, {
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

test("[§7.15] dispatch budget/current answers unavailable without usage", async () => {
	const outcome = await dispatchMethod(
		"budget/current",
		{},
		{
			root: "/repo",
		},
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "available"), false);
		assert.equal(field(value, "status"), "unavailable");
	}
	const named = await dispatchMethod(
		"budget/current",
		{ sessionId: "s9" },
		{
			root: "/repo",
		},
	);
	assert.equal(named.ok, true);
	const bad = await dispatchMethod("budget/current", [], { root: "/repo" });
	assert.equal(bad.ok, false);
	if (!bad.ok) {
		assert.equal(bad.error.code, -32602);
	}
});

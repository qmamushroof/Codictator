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

test("[§7.15] dispatch events/tail pages by since and limit", async () => {
	const repo = createTempRepo({
		".codictator/config.json": MINIMAL_CONFIG,
		".codictator/state/events.jsonl": [
			verdictLine("e1"),
			verdictLine("e2"),
			injectionLine("i1", "s1"),
			injectionLine("i2", "s2"),
			"",
		].join("\n"),
	});
	try {
		const all = await dispatchMethod("events/tail", {}, { root: repo.dir });
		assert.equal(all.ok, true);
		if (all.ok) {
			assert.equal(
				(field(recordOf(all.value), "events") as Array<unknown>).length,
				4,
			);
		}
		const after = await dispatchMethod(
			"events/tail",
			{ since: "e1" },
			{
				root: repo.dir,
			},
		);
		assert.equal(after.ok, true);
		if (after.ok) {
			const events = field(recordOf(after.value), "events") as Array<unknown>;
			assert.equal(events.length, 3);
			assert.equal(field(recordOf(events[0]), "id"), "e2");
		}
		const capped = await dispatchMethod(
			"events/tail",
			{ limit: 1 },
			{
				root: repo.dir,
			},
		);
		assert.equal(capped.ok, true);
		if (capped.ok) {
			assert.equal(
				(field(recordOf(capped.value), "events") as Array<unknown>).length,
				1,
			);
		}
		const missed = await dispatchMethod(
			"events/tail",
			{ since: "gone" },
			{
				root: repo.dir,
			},
		);
		assert.equal(missed.ok, true);
		if (missed.ok) {
			assert.equal(
				(field(recordOf(missed.value), "events") as Array<unknown>).length,
				0,
			);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] dispatch events/tail with a bad limit answers invalid params", async () => {
	const repo = createTempRepo({
		".codictator/config.json": MINIMAL_CONFIG,
		".codictator/state/events.jsonl": `${verdictLine("e1")}\n`,
	});
	try {
		for (const params of [
			{ limit: 0 },
			{ limit: -2 },
			{ since: 5 },
			[],
		] as Array<unknown>) {
			const outcome = await dispatchMethod("events/tail", params, {
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

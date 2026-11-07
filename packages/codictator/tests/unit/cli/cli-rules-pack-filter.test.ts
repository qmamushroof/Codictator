// SPEC §7.15 D6: rules/list answers the configured packs only, with
// engine-stamped versions. Unconfigured built-ins stay unlisted; the
// "0.0.0" source placeholder renders the engine version, never itself.
import { strict as assert } from "node:assert";
import test from "node:test";
import { dispatchMethod } from "../../../src/cli/serve-methods.ts";
import { field } from "../../../src/cli/serve-shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function configWith(packs: ReadonlyArray<{ id: string }>): string {
	return JSON.stringify({
		version: 1,
		codictator: "9.9.9",
		packs,
		harnesses: ["opencode"],
	});
}

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

test("[§7.15] rules/list answers only configured packs with real versions", async () => {
	// SPEC §7.15: the row filters to config.packs; the core pack renders
	// the engine version instead of the 0.0.0 source placeholder.
	const repo = createTempRepo({
		".codictator/config.json": configWith([{ id: "core" }]),
	});
	try {
		const outcome = await dispatchMethod("rules/list", undefined, {
			root: repo.dir,
			engineVersion: "9.9.9",
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			const rules = field(value, "rules") as Array<unknown>;
			assert.ok(rules.length > 0);
			const packs = new Set(
				rules.map((rule) => String(field(recordOf(rule), "pack"))),
			);
			for (const pack of packs) {
				assert.ok(pack.startsWith("core@"));
				assert.ok(!pack.includes("0.0.0"));
			}
			assert.ok(packs.has("core@9.9.9"));
		}
	} finally {
		repo.cleanup();
	}
});

test("[§7.15] rules/list with no configured packs answers no rules", async () => {
	// An empty config.packs means no rules: unconfigured built-ins are
	// never listed.
	const repo = createTempRepo({
		".codictator/config.json": configWith([]),
	});
	try {
		const outcome = await dispatchMethod("rules/list", undefined, {
			root: repo.dir,
			engineVersion: "9.9.9",
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.deepEqual(field(value, "rules"), []);
		}
	} finally {
		repo.cleanup();
	}
});

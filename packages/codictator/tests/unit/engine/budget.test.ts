// SPEC §4.3.7: the agent-facing verdict message stays inside 1,200 bytes.
// createEngine still throws "not implemented", so this fails red until
// Phase 4 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import { createEngine } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

test("[§4.3.7] agent message fits in 1,200 bytes", async () => {
	// SPEC §4.3.7: at most 1,200 bytes for the first three findings plus a
	// count line for the rest.
	const engine = createEngine([]);
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.ok(Buffer.byteLength(verdict.message, "utf8") <= 1200);
});

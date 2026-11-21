// SPEC §4.6.5: core/graph-before-scan stays inactive until PRD §13 Q2 is
// answered, so its glob-broad probe is the one L1 row expected to stay
// quiet; the umbrella firing guard excludes it rather than activating it.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runL1Probes } from "../support/consumer-l1-run.ts";
import { INACTIVE_RULES } from "../support/consumer-matrix.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[consumer] core/graph-before-scan stays inactive per SPEC §4.6.5 and the umbrella excludes it", async () => {
	assert.ok(INACTIVE_RULES.has("core/graph-before-scan"));
	const repo = createTempRepo();
	try {
		const hits = await runL1Probes(repo);
		const hit = hits.get("glob-broad::core/graph-before-scan");
		assert.ok(hit !== undefined, "glob-broad probe recorded no result");
		assert.equal(hit.fired, false, `rule fired while inactive: ${hit.detail}`);
	} finally {
		repo.cleanup();
	}
});

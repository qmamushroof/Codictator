// Slice 0 meta-guard, part 2: every L1-mapped floor rule fires on its
// consumer-shaped hook probe through the installed launcher. Red today
// (G1–G3); slice 1 greens these rows without changing what is asserted.
import { strict as assert } from "node:assert";
import test from "node:test";
import { HOOK_CASES } from "../support/consumer-l1-cases.ts";
import { runL1Probes, silentRules } from "../support/consumer-l1-run.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[consumer] every L1-mapped floor rule fires on its hook probe", async () => {
	const owned = (probe: string): boolean =>
		probe === "session" || HOOK_CASES[probe] !== undefined;
	const repo = createTempRepo();
	try {
		const hits = await runL1Probes(repo);
		const misses = silentRules(hits, (_rule, probe) => owned(probe));
		assert.deepEqual(
			misses,
			[],
			`${misses.length} L1 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		repo.cleanup();
	}
});

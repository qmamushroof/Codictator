// SPEC §4.3.3 step 2: enforcers run bounded (at most
// os.availableParallelism()), so a full-tree scope never starves guards
// into CDX-E902.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Enforcer } from "../../../src/features/engine/index.ts";
import { createEngine } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

test("[§4.3.3] bounded evaluation shares the event loop across guards", async () => {
	let active = 0;
	let maxActive = 0;
	const ids = [
		"core/guard-0",
		"core/guard-1",
		"core/guard-2",
		"core/guard-3",
		"core/guard-4",
		"core/guard-5",
		"core/guard-6",
		"core/guard-7",
	];
	const enforcers: Array<Enforcer> = ids.map((id) => ({
		id,
		kinds: ["startup"],
		budgetMs: 1000,
		check: async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active -= 1;
			return [
				{
					ruleId: id,
					message: `finding from ${id}`,
					remediation: "do the compliant thing",
				},
			];
		},
	}));
	const engine = createEngine(enforcers);
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.ok(
		maxActive <= 4,
		`expected bounded concurrency, saw ${maxActive} guards in flight`,
	);
	assert.equal(verdict.findings.length, ids.length);
	assert.deepEqual(
		verdict.findings.map((finding) => finding.ruleId),
		[...ids].sort(),
	);
	assert.ok(verdict.findings.every((finding) => finding.code === undefined));
});

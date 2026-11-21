// Roadmap 14.5, range family: the L4 verify-tdd-range rules that stayed
// silent because each judged fixture marker reports only, or because the
// probe never broke them; this per-family guard asserts exactly these rows.
// BUG-0110: core/no-threshold-lowering and core/custom-pack-selftest joined
// once SPEC §4.10.4 and §4.4.4 settled them.
import { strict as assert } from "node:assert";
import test from "node:test";
import { installConsumer } from "../support/consumer-harness.ts";
import type { ProbeHit } from "../support/consumer-l1-run.ts";
import { runRangeProbe } from "../support/consumer-l4-range.ts";
import { MATRIX } from "../support/consumer-matrix.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const RANGE_FAMILY: ReadonlySet<string> = new Set([
	"core/no-guard-removal",
	"core/arch-profile-declared",
	"core/no-assertion-loss",
	"core/no-new-suppressions",
	"core/no-fixture-shrink",
	"core/test-command-intact",
	"core/regression-test-for-fix",
	"core/no-baseline-raise",
	"core/review-gate",
	"core/bug-registry",
	"core/compiler-strict",
	"core/perf-budgets",
	"core/ci-present",
	"core/waivers-valid",
	"core/no-threshold-lowering",
	"core/custom-pack-selftest",
	"ts/lint",
	"ts/typecheck",
	"python/lint",
	"python/typecheck",
]);

test("[consumer] the verify-range L4 floor rules fire on their gate probe", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const hits = new Map<string, ProbeHit>();
		await runRangeProbe(repo, hits);
		const misses = MATRIX.filter(([rule]) => RANGE_FAMILY.has(rule))
			.filter(([rule, probe]) => hits.get(`${probe}::${rule}`)?.fired !== true)
			.map(
				([rule, probe]) =>
					`${rule} (${probe}) silent: ${hits.get(`${probe}::${rule}`)?.detail ?? "no probe result"}`,
			);
		assert.deepEqual(
			misses,
			[],
			`${misses.length} range-family L4 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		repo.cleanup();
	}
});

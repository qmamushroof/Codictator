// Roadmap 14.5, stage family: the ten L3 rules whose staged or commit-msg
// probe stayed silent because each judged fixture marker reports only. The
// umbrella title in consumer-enforcement-firing-l34.test.ts stays
// ledger-listed until the range family lands; this per-family guard asserts
// exactly these rows.
import { strict as assert } from "node:assert";
import test from "node:test";
import { installConsumer } from "../support/consumer-harness.ts";
import type { ProbeHit } from "../support/consumer-l1-run.ts";
import { runStageProbes } from "../support/consumer-l3-stage.ts";
import { MATRIX } from "../support/consumer-matrix.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const STAGE_FAMILY: ReadonlySet<string> = new Set([
	"core/conventional-commit",
	"core/repo-hygiene",
	"core/doc-router-leaf",
	"core/doc-links-valid",
	"core/doc-no-inline-changelog",
	"core/doc-single-owner",
	"core/dep-no-vulnerable",
	"core/dep-no-deprecated",
	"core/dep-new-needs-reason",
	"core/dep-lockfile",
]);

test("[consumer] the stage-probe L3 floor rules fire on their gate probes", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const hits = new Map<string, ProbeHit>();
		await runStageProbes(repo, hits);
		const misses = MATRIX.filter(([rule]) => STAGE_FAMILY.has(rule))
			.filter(([rule, probe]) => hits.get(`${probe}::${rule}`)?.fired !== true)
			.map(
				([rule, probe]) =>
					`${rule} (${probe}) silent: ${hits.get(`${probe}::${rule}`)?.detail ?? "no probe result"}`,
			);
		assert.deepEqual(
			misses,
			[],
			`${misses.length} stage-family L3 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		repo.cleanup();
	}
});

// Roadmap 14.4, write family: the eleven L1 rules whose write probe was
// blocked by core/workflow-gates before the target rule fired. The umbrella
// title in consumer-enforcement-firing-l1.test.ts stays ledger-listed until
// every family is green; this per-family guard asserts exactly these rows.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runL1Probes, silentRules } from "../support/consumer-l1-run.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const WRITE_FAMILY: ReadonlySet<string> = new Set([
	"core/red-before-green",
	"core/arch-module-mapped",
	"core/arch-boundaries",
	"core/arch-public-entry",
	"core/arch-no-cycles",
	"core/bug-rows-immutable",
	"core/diagnose-before-fix",
	"core/dep-one-per-capability",
	"core/ci-actions-pinned",
	"core/file-naming",
	"ts/no-phantom-import",
]);

test("[consumer] the write-probe L1 floor rules fire on their hook probes", async () => {
	const repo = createTempRepo();
	try {
		const hits = await runL1Probes(repo);
		const misses = silentRules(hits, (rule) => WRITE_FAMILY.has(rule));
		assert.deepEqual(
			misses,
			[],
			`${misses.length} write-family L1 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		repo.cleanup();
	}
});

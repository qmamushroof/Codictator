// SPEC §4.9.3 core/history-entry: a record file exempts only a
// records-only change. A code change that also carries a BUGS row (for
// example the tracked-BUGS fallback union) still owes a HISTORY entry.
import { strict as assert } from "node:assert";
import test from "node:test";
import { historyEntryReal } from "../../../src/features/packs/enforcers/records-history-guards.ts";

test("[§4.9.3] records-only change owes no history entry", async () => {
	assert.deepEqual(await historyEntryReal(["docs/BUGS/2026.md"]), []);
	assert.deepEqual(
		await historyEntryReal(["docs/HISTORY/2026-11-08.md", "docs/BUGS/2026.md"]),
		[],
	);
});

test("[§4.9.3] code change carrying a BUGS row still owes a history entry", async () => {
	const findings = await historyEntryReal(["src/a.ts", "docs/BUGS/2026.md"]);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/history-entry");
	assert.equal(findings[0]?.path, "docs/HISTORY/");
});

test("[§4.9.3] code range carrying a HISTORY entry owes no further entry", async () => {
	assert.deepEqual(
		await historyEntryReal([
			"docs/BUGS/2026.md",
			"docs/HISTORY/2026-11-09.md",
			"packages/codictator/src/cli/ci.ts",
			"packages/codictator/tests/red-ledger.json",
		]),
		[],
	);
});

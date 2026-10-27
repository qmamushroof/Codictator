// SPEC §8.2: one red test per exit code; SPEC §8.1: one red explain test
// per error code. Exit rows assert runCommand; explain rows assert explain.
// Both contracts still throw "not implemented", so all sixty-six fail red
// until their implementations land.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runCommand } from "../../src/cli/index.ts";
import { explain } from "../../src/features/audit/index.ts";

test("[§8.2] exit 0 on allow or advise only", async () => {
	// SPEC §8.2: verify with no blocking findings resolves ok.
	const result = await runCommand({ argv: ["verify"], cwd: "/repo" });
	assert.equal(result.ok, true);
});

test("[§8.2] exit 1 on blocked findings or a blocking error", async () => {
	// SPEC §8.2: an external tool failure blocks with CDX-E207.
	const result = await runCommand({ argv: ["verify"], cwd: "/repo" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E207");
	}
});

test("[§8.2] exit 2 on a usage error", async () => {
	// SPEC §8.2: an unknown command is a usage error, not a CdxError row.
	const result = await runCommand({ argv: ["frobnicate"], cwd: "/repo" });
	assert.equal(result.ok, false);
});

test("[§8.2] exit 3 on invalid configuration, pack or schema", async () => {
	// SPEC §8.2: an unparseable config fails with CDX-E101.
	const result = await runCommand({ argv: ["verify"], cwd: "/repo" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E101");
	}
});

test("[§8.2] exit 4 on a human-only command without a human", async () => {
	// SPEC §8.2: waive from a non-TTY fails with CDX-E107.
	const result = await runCommand({
		argv: ["waive", "core/no-secrets", "--reason", "test"],
		cwd: "/repo",
	});
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E107");
	}
});

test("[§8.2] exit 5 on unavailable data", async () => {
	// SPEC §8.2: unreachable registry and snapshots fail with CDX-E401.
	const result = await runCommand({ argv: ["deps", "check"], cwd: "/repo" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E401");
	}
});

test("[§8.2] exit 6 on a missing prerequisite or environment", async () => {
	// SPEC §8.2: a Node older than engines.node fails with CDX-E002.
	const result = await runCommand({ argv: ["verify"], cwd: "/repo" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E002");
	}
});

test("[§8.2] exit 7 on an internal error", async () => {
	// SPEC §8.2: a throwing enforcer fails closed with CDX-E901.
	const result = await runCommand({ argv: ["verify"], cwd: "/repo" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E901");
	}
});

// SPEC §8.1: 58 explain targets: 53 explicit rows plus the E211-E216
// self-test-failure range (§4.4.4), i.e. E001, E002, E003, E010, E011,
// E101-E110, E201-E210, E211-E216, E301, E302, E303, E305, E306, E401,
// E501, E503, E601, E602, E604-E609, E701, E702, E703, E801, E851-E854,
// E901, E902, E903. Gaps (E304, E502, E603) are unassigned, never skipped.
const explainCodes: ReadonlyArray<string> = [
	"CDX-E001",
	"CDX-E002",
	"CDX-E003",
	"CDX-E010",
	"CDX-E011",
	"CDX-E101",
	"CDX-E102",
	"CDX-E103",
	"CDX-E104",
	"CDX-E105",
	"CDX-E106",
	"CDX-E107",
	"CDX-E108",
	"CDX-E109",
	"CDX-E110",
	"CDX-E201",
	"CDX-E202",
	"CDX-E203",
	"CDX-E204",
	"CDX-E205",
	"CDX-E206",
	"CDX-E207",
	"CDX-E208",
	"CDX-E209",
	"CDX-E210",
	"CDX-E211",
	"CDX-E212",
	"CDX-E213",
	"CDX-E214",
	"CDX-E215",
	"CDX-E216",
	"CDX-E301",
	"CDX-E302",
	"CDX-E303",
	"CDX-E305",
	"CDX-E306",
	"CDX-E401",
	"CDX-E501",
	"CDX-E503",
	"CDX-E601",
	"CDX-E602",
	"CDX-E604",
	"CDX-E605",
	"CDX-E606",
	"CDX-E607",
	"CDX-E608",
	"CDX-E609",
	"CDX-E701",
	"CDX-E702",
	"CDX-E703",
	"CDX-E801",
	"CDX-E851",
	"CDX-E852",
	"CDX-E853",
	"CDX-E854",
	"CDX-E901",
	"CDX-E902",
	"CDX-E903",
];

for (const code of explainCodes) {
	test(`[§8.1] explain ${code}`, async () => {
		// SPEC §4.18.2: explain prints the §8 row for an error code.
		const text = await explain(code);
		assert.ok(text.includes(code));
	});
}

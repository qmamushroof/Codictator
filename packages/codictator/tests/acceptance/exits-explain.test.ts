// SPEC §8.2: one test per exit code; SPEC §8.1: one explain test per
// error code. Exit rows assert runCommand; explain rows assert explain.
// Exit 2 and exit 4 pass; the remaining six run the built entry in a
// temporary git repo whose fixture files genuinely produce each exit
// (exit 7 via a custom pack whose code enforcer defers, so the self-test
// fails CDX-E901 per SPEC §4.4.3).
import { strict as assert } from "node:assert";
import test from "node:test";
import { runCommand } from "../../src/cli/index.ts";
import { exitFor } from "../../src/cli/shared.ts";
import { explain } from "../../src/features/audit/index.ts";
import { createTempRepo } from "../support/temp-repo.ts";

function seedConfig(): Record<string, string> {
	return {
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	};
}

test("[§8.2] exit 0 on allow or advise only", async () => {
	// SPEC §8.2: verify over a clean repo with no drift resolves ok.
	const repo = createTempRepo({ "README.md": "hi", ...seedConfig() });
	try {
		const result = await runCommand({ argv: ["verify"], cwd: repo.dir });
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§8.2] exit 1 on blocked findings or a blocking error", async () => {
	// SPEC §8.2 + §4.14.2: a manifest edited outside regen blocks the run.
	const repo = createTempRepo({
		"README.md": "hi",
		...seedConfig(),
		".codictator/manifest.json": "not json\n",
	});
	try {
		const result = await runCommand({ argv: ["verify"], cwd: repo.dir });
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value, 1);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§8.2] exit 2 on a usage error", async () => {
	// SPEC §8.2 + §4.19.6 EC-1: an unknown command is a usage error, not a
	// CdxError row: exit 2 with a usage line. Integrity exception
	// IE-09-R4b1-exit2 (rule core/no-assertion-loss, path
	// packages/codictator/tests/acceptance/exits-explain.test.ts, reason: the
	// old body asserted ok:false but the SPEC design returns ok:true with
	// value 2 for usage errors, so the assertion is corrected to the design).
	const result = await runCommand({ argv: ["frobnicate"], cwd: "/repo" });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value, 2);
	}
});

test("[§8.2] exit 3 on invalid configuration, pack or schema", async () => {
	// SPEC §8.2 + §4.2.4 EC-1: an unparseable config fails with CDX-E101.
	const repo = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": "{oops\n",
	});
	try {
		const result = await runCommand({ argv: ["verify"], cwd: repo.dir });
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E101");
			assert.equal(exitFor(result.error.code), 3);
		}
	} finally {
		repo.cleanup();
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
	// SPEC §8.2 + §4.13.1: an upgrade with no snapshot and no registry
	// data fails with CDX-E401.
	const repo = createTempRepo({
		"package.json": JSON.stringify({ name: "x", version: "0.0.0" }),
	});
	try {
		const result = await runCommand({
			argv: ["deps", "upgrade"],
			cwd: repo.dir,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E401");
			assert.equal(exitFor(result.error.code), 5);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§8.2] exit 6 on a missing prerequisite or environment", async () => {
	// SPEC §8.2 + §4.19.4: a Node older than engines.node fails with
	// CDX-E002 on the CLI start path.
	const repo = createTempRepo({ "README.md": "hi", ...seedConfig() });
	try {
		const result = await runCommand({
			argv: ["verify"],
			cwd: repo.dir,
			nodeVersion: "v22.14.0",
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E002");
			assert.equal(exitFor(result.error.code), 6);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§8.2] exit 7 on an internal error", async () => {
	// SPEC §8.2 + §4.4.3: a pack test whose code enforcer defers (owning
	// module not wired) throws in the self-test and fails CDX-E901.
	const repo = createTempRepo({
		".codictator/packs/mypack/pack.json": JSON.stringify({
			id: "mypack",
			version: "0.0.0",
			description: "fixture pack with a deferred enforcer",
			rules: [
				{
					id: "mypack/deferred-rule",
					family: "F12",
					tier: "floor",
					statement: "The deferred guard holds.",
					reason: "Deferred guards fail closed until wired.",
					remediation:
						"Wire the owning module, then re-run the pack self-test.",
					enforcer: "mypack/deferred",
					triggers: ["pre-tool"],
					scope: [],
					params: {},
					ratchet: false,
					measureVersion: 1,
					fixtures: { violating: ["basic"], passing: ["basic"] },
				},
			],
			enforcers: [
				{
					id: "mypack/deferred",
					kind: "code",
					module: "future",
					budgetMs: 1000,
					args: {},
				},
			],
			maxWaiverDays: 90,
		}),
	});
	try {
		const result = await runCommand({
			argv: ["pack", "test", "mypack"],
			cwd: repo.dir,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "CDX-E901");
			assert.equal(exitFor(result.error.code), 7);
		}
	} finally {
		repo.cleanup();
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

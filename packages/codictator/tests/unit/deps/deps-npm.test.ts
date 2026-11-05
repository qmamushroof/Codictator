import { strict as assert } from "node:assert";

import test from "node:test";

import {
	checkDeps,
	compareNpmVersions,
	eligibleStableVersions,
	isNpmPrerelease,
	lagDaysFor,
	parseNpmVersion,
	type RegistrySnapshot,
	resolveLatest,
	selectLatestStable,
	snapshotAdvisoriesFor,
} from "../../../src/features/deps/index.ts";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctx(): CheckContext {
	return {
		trigger: "scheduled",
		scope: { files: ["package.json"], sessionId: "s" },
		now: FIXED_INSTANT,
		configHash: "hash",
	};
}

function snapshot(
	versions: ReadonlyArray<string>,
	published = "2025-01-01T00:00:00.000Z",
): RegistrySnapshot {
	const table: Record<string, { published: string }> = {};
	for (const version of versions) {
		table[version] = { published };
	}
	return {
		version: 1,
		ecosystem: "npm",
		fetchedAt: FIXED_INSTANT,
		packages: { lodash: { versions: table } },
		advisories: {},
	};
}

test("[§4.8.3] semver parses releases and prereleases", () => {
	assert.deepEqual(parseNpmVersion("4.17.21"), {
		major: 4,
		minor: 17,
		patch: 21,
		prerelease: undefined,
	});
	assert.deepEqual(parseNpmVersion("5.0.0-beta.1")?.prerelease, ["beta", "1"]);
	assert.deepEqual(parseNpmVersion("1.0.0+build")?.prerelease, undefined);
	assert.equal(parseNpmVersion("1.2"), undefined);
	assert.equal(parseNpmVersion("^1.2.3"), undefined);
	assert.equal(parseNpmVersion(""), undefined);
});

test("[§4.8.3] prerelease detection marks beta pins", () => {
	assert.equal(isNpmPrerelease("5.0.0-beta.1"), true);
	assert.equal(isNpmPrerelease("4.17.21"), false);
	assert.equal(isNpmPrerelease("not-a-version"), false);
});

test("[§4.8.3] version order compares numerically", () => {
	const left = parseNpmVersion("4.17.9");
	const right = parseNpmVersion("4.17.21");
	assert.ok(left !== undefined && right !== undefined);
	assert.equal(compareNpmVersions(left, right), -1);
	assert.equal(compareNpmVersions(right, left), 1);
	assert.equal(compareNpmVersions(left, left), 0);
});

test("[§4.8.3] release beats prerelease of the same line", () => {
	const release = parseNpmVersion("2.0.0");
	const pre = parseNpmVersion("2.0.0-rc.1");
	assert.ok(release !== undefined && pre !== undefined);
	assert.equal(compareNpmVersions(pre, release), -1);
	assert.equal(compareNpmVersions(release, pre), 1);
});

test("[§4.8.3] prerelease identifiers compare per semver", () => {
	const numeric = parseNpmVersion("1.0.0-1");
	const alpha = parseNpmVersion("1.0.0-alpha");
	const longer = parseNpmVersion("1.0.0-alpha.1");
	assert.ok(
		numeric !== undefined && alpha !== undefined && longer !== undefined,
	);
	assert.equal(compareNpmVersions(numeric, alpha), -1);
	assert.equal(compareNpmVersions(alpha, longer), -1);
	assert.equal(compareNpmVersions(alpha, alpha), 0);
});

test("[§4.8.3] eligibility excludes prereleases and yanked versions", () => {
	const table: RegistrySnapshot = {
		version: 1,
		ecosystem: "npm",
		fetchedAt: FIXED_INSTANT,
		packages: {
			lodash: {
				versions: {
					"4.17.21": { published: "2025-01-01T00:00:00.000Z" },
					"5.0.0-beta.1": { published: "2025-01-01T00:00:00.000Z" },
					"4.17.20": {
						published: "2025-01-01T00:00:00.000Z",
						yanked: true,
					},
				},
			},
		},
		advisories: {},
	};
	const eligible = eligibleStableVersions(table, "lodash");
	assert.deepEqual(
		eligible.map((entry) => entry.version),
		["4.17.21"],
	);
});

test("[§4.8.3] eligibility excludes future and underage versions", () => {
	const young = snapshot(["4.17.21"], "2025-12-31T00:00:00.000Z");
	assert.deepEqual(eligibleStableVersions(young, "lodash"), []);
	const future = snapshot(["4.17.21"], "2026-06-01T00:00:00.000Z");
	assert.deepEqual(eligibleStableVersions(future, "lodash"), []);
});

test("[§4.8.3] eligibility excludes advised versions", () => {
	const table = snapshot(["4.17.20", "4.17.21"]);
	const advised: RegistrySnapshot = {
		...table,
		advisories: { "lodash@4.17.21": ["GHSA-x"] },
	};
	assert.deepEqual(
		eligibleStableVersions(advised, "lodash").map((entry) => entry.version),
		["4.17.20"],
	);
	assert.deepEqual(snapshotAdvisoriesFor(advised, "lodash", "4.17.21"), [
		"GHSA-x",
	]);
	assert.deepEqual(snapshotAdvisoriesFor(advised, "lodash", "4.17.20"), []);
});

test("[§4.8.3] S9 exempts the young fix for a vulnerable pin", () => {
	const table: RegistrySnapshot = {
		version: 1,
		ecosystem: "npm",
		fetchedAt: "2026-01-01T00:00:00.000Z",
		packages: {
			lodash: {
				versions: {
					"4.17.20": { published: "2025-01-01T00:00:00.000Z" },
					"4.17.21": { published: "2025-12-31T00:00:00.000Z" },
				},
			},
		},
		advisories: { "lodash@4.17.20": ["GHSA-x"] },
	};
	const eligible = eligibleStableVersions(table, "lodash", {
		pinned: "4.17.20",
	});
	assert.equal(eligible.length, 1);
	assert.equal(eligible[0]?.version, "4.17.21");
	assert.equal(eligible[0]?.viaSecurityExemption, true);
});

test("[§4.8.3] S9 needs the same major and a clean fix", () => {
	const table: RegistrySnapshot = {
		version: 1,
		ecosystem: "npm",
		fetchedAt: "2026-01-01T00:00:00.000Z",
		packages: {
			lodash: {
				versions: {
					"4.17.20": { published: "2025-01-01T00:00:00.000Z" },
					"5.0.0": { published: "2025-12-31T00:00:00.000Z" },
				},
			},
		},
		advisories: {
			"lodash@4.17.20": ["GHSA-x"],
			"lodash@5.0.0": ["GHSA-x"],
		},
	};
	assert.deepEqual(
		eligibleStableVersions(table, "lodash", { pinned: "4.17.20" }),
		[],
	);
});

test("[§4.8.3] selection returns the maximum eligible version", () => {
	const selected = selectLatestStable(
		snapshot(["4.17.20", "4.17.21"]),
		"lodash",
	);
	assert.ok(selected.ok);
	assert.equal(selected.value.version, "4.17.21");
});

test("[§4.8.3] selection fails closed on an empty eligible set", () => {
	const selected = selectLatestStable(snapshot(["5.0.0-beta.1"]), "lodash");
	assert.equal(selected.ok, false);
	assert.ok(!selected.ok && selected.error.code === "CDX-E401");
	const missing = selectLatestStable(snapshot(["4.17.21"]), "missing");
	assert.equal(missing.ok, false);
});

test("[§4.8.3] selection honors the runtime predicate", () => {
	const table = snapshot(["4.17.21"]);
	const blocked = selectLatestStable(table, "lodash", {
		satisfiesRuntime: () => false,
	});
	assert.equal(blocked.ok, false);
});

test("[§4.8.3] lag is zero at latest and positive behind", () => {
	const table = snapshot(["4.17.20", "4.17.21"]);
	assert.equal(lagDaysFor(table, "lodash", "4.17.21"), 0);
	const lag = lagDaysFor(table, "lodash", "4.17.20");
	assert.ok(lag !== undefined && lag > 300);
	assert.equal(lagDaysFor(table, "lodash", "bogus"), undefined);
	assert.equal(
		lagDaysFor({ ...table, fetchedAt: "bogus" }, "lodash", "4.17.20"),
		undefined,
	);
});

test("[§4.8.3] resolveLatest resolves against the snapshot", () => {
	const latest = resolveLatest(snapshot(["4.17.20", "4.17.21"]), "lodash");
	assert.ok(latest.ok && latest.value === "4.17.21");
	const failed = resolveLatest(snapshot(["5.0.0-beta.1"]), "lodash");
	assert.equal(failed.ok, false);
});

test("[§4.8.5] checkDeps blocks ranges and passes exact pins", async () => {
	const blocked = await checkDeps(ctx(), [
		{
			ecosystem: "npm",
			path: "package.json",
			dependencies: [{ name: "a", range: "^1.0.0" }],
		},
	]);
	assert.ok(blocked.some((finding) => finding.ruleId === "core/dep-exact-pin"));
	const passing = await checkDeps(ctx(), [
		{
			ecosystem: "npm",
			path: "package.json",
			dependencies: [{ name: "a", range: "1.0.0" }],
		},
	]);
	assert.deepEqual(passing, []);
});

test("[§4.8.5] checkDeps blocks prerelease pins as never stable", async () => {
	const findings = await checkDeps(ctx(), [
		{
			ecosystem: "npm",
			path: "package.json",
			dependencies: [{ name: "a", range: "2.0.0-beta.1" }],
		},
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/dep-latest-stable"),
	);
});

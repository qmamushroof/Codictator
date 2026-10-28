// SPEC §4.8, §5.3, §6.1: unit cover for the npm driver, registry and OSV
// clients, latest-stable selection, verdicts and bot config. Net clients run
// against the FakeNet stub, so no test reaches the public network (§10.2).
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	checkDependabotOwnedKeys,
	checkDeps,
	checkRenovateOwnedKeys,
	compareNpmVersions,
	detectUpgradeBots,
	eligibleStableVersions,
	evaluateDepVerdicts,
	fetchNpmPackument,
	fetchOsvAdvisoryIds,
	fetchOsvRanges,
	hashSnapshot,
	isExactNpmPin,
	isNpmPrerelease,
	isRetryableStatus,
	lagDaysFor,
	lockfileMismatches,
	narrowOsvRanges,
	osvAdvisoryAffects,
	parseNpmrc,
	parseNpmVersion,
	parsePackageJson,
	parsePackageLock,
	privateRegistryHosts,
	type RegistrySnapshot,
	resolveLatest,
	selectLatestStable,
	snapshotAdvisoriesFor,
	snapshotAsOf,
	snapshotFreshness,
	upgradeBranchName,
} from "../../../src/features/deps/index.ts";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeNet } from "../../support/fake-net.ts";

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

test("[§6.1] pin forms classify every range shape", async () => {
	const { classifyNpmRange } = await import(
		"../../../src/features/deps/index.ts"
	);
	assert.equal(classifyNpmRange("1.2.3"), "exact");
	assert.equal(classifyNpmRange("v1.2.3"), "exact");
	assert.equal(classifyNpmRange("1.2.3-beta.1"), "exact");
	assert.equal(classifyNpmRange("^1.2.3"), "range");
	assert.equal(classifyNpmRange(">=1.0.0 <2.0.0"), "range");
	assert.equal(classifyNpmRange("*"), "tag");
	assert.equal(classifyNpmRange("latest"), "tag");
	assert.equal(classifyNpmRange("beta"), "tag");
	assert.equal(classifyNpmRange("npm:other@1.2.3"), "alias-exact");
	assert.equal(classifyNpmRange("npm:other@^1.2.3"), "alias-range");
	assert.equal(classifyNpmRange("workspace:1.2.3"), "workspace-exact");
	assert.equal(classifyNpmRange("workspace:*"), "workspace-range");
	assert.equal(classifyNpmRange("workspace:^1.0.0"), "workspace-range");
	assert.equal(classifyNpmRange("file:../lib"), "file");
	assert.equal(classifyNpmRange("link:../lib"), "link");
	assert.equal(
		classifyNpmRange("git+https://example.com/r.git#abc123"),
		"git-unpinned",
	);
	assert.equal(classifyNpmRange("github:user/repo"), "git-unpinned");
	assert.equal(classifyNpmRange("https://example.com/t.tgz"), "tarball-url");
	const sha = "a".repeat(40);
	assert.equal(
		classifyNpmRange(`git+https://example.com/r.git#${sha}`),
		"git-sha",
	);
	assert.equal(isExactNpmPin("1.2.3"), true);
	assert.equal(isExactNpmPin("^1.2.3"), false);
	assert.equal(isExactNpmPin("latest"), false);
});

test("[§6.1] manifest parsing separates pins from compat", () => {
	const parsed = parsePackageJson(
		JSON.stringify({
			dependencies: { a: "1.0.0" },
			devDependencies: { b: "^2.0.0" },
			optionalDependencies: { c: "3.0.0" },
			peerDependencies: { d: ">=4.0.0" },
			engines: { node: ">=24" },
			packageManager: "npm@11.0.0",
			workspaces: ["packages/*"],
		}),
	);
	assert.ok(parsed.ok);
	assert.equal(parsed.value.dependencies.length, 3);
	assert.deepEqual(parsed.value.engines, { node: ">=24" });
	assert.deepEqual(parsed.value.peerRanges, { d: ">=4.0.0" });
	assert.equal(parsed.value.packageManager, "npm@11.0.0");
});

test("[§6.1] manifest parsing rejects malformed roots", () => {
	assert.equal(parsePackageJson("{oops").ok, false);
	assert.ok(!parsePackageJson("[1]").ok);
	const named = parsePackageJson("[1]");
	assert.ok(!named.ok && named.error.code === "CDX-E101");
	const workspaces = parsePackageJson(
		JSON.stringify({ workspaces: { packages: ["a", 1] } }),
	);
	assert.ok(workspaces.ok && workspaces.value.workspaces.length === 1);
});

test("[§6.1] lockfile parsing pins root and nested versions", () => {
	const parsed = parsePackageLock(
		JSON.stringify({
			lockfileVersion: 3,
			packages: {
				"": { dependencies: { a: "1.0.0" }, devDependencies: { b: "2.0.0" } },
				"node_modules/c": { version: "3.0.0" },
			},
		}),
	);
	assert.ok(parsed.ok);
	assert.equal(parsed.value.lockfileVersion, 3);
	assert.deepEqual(parsed.value.pinned, { a: "1.0.0", b: "2.0.0", c: "3.0.0" });
	assert.ok(!parsePackageLock("{oops").ok);
	assert.ok(!parsePackageLock(JSON.stringify({ lockfileVersion: 3 })).ok);
});

test("[§4.8.5] lockfile sync flags missing and drifted pins", () => {
	const lock = {
		lockfileVersion: 3,
		pinned: { a: "1.0.0", b: "9.9.9" },
	};
	const mismatched = lockfileMismatches(
		[
			{ name: "a", range: "1.0.0", kind: "prod" as const },
			{ name: "b", range: "2.0.0", kind: "prod" as const },
			{ name: "c", range: "3.0.0", kind: "prod" as const },
			{ name: "d", range: "^4.0.0", kind: "prod" as const },
		],
		lock,
	);
	assert.deepEqual(mismatched, ["b", "c", "d"]);
});

test("[§6.1] npmrc parsing names scoped private registries", () => {
	const parsed = parseNpmrc(
		"# comment\nsave-exact=true\nregistry=https://registry.npmjs.org/\n@acme:registry=https://npm.acme.test/\n",
	);
	assert.equal(parsed.saveExact, true);
	assert.deepEqual(privateRegistryHosts(parsed), ["npm.acme.test"]);
	const bare = parseNpmrc(
		"save-exact=false\nnot-a-url=:registry=:::\nkey-without-equals\n",
	);
	assert.equal(bare.saveExact, false);
	assert.deepEqual(privateRegistryHosts(bare), []);
});

test("[§4.8.2] registry fetch narrows the full document", async () => {
	const net = new FakeNet();
	net.route("GET", "https://registry.npmjs.org/lodash", {
		status: 200,
		headers: {},
		body: JSON.stringify({
			time: {
				created: "x",
				modified: "y",
				"4.17.21": "2025-01-01T00:00:00.000Z",
			},
			versions: {
				"4.17.21": {
					deprecated: "use v5",
					license: "MIT",
					engines: { node: ">=24" },
				},
			},
		}),
	});
	const fetched = await fetchNpmPackument(net, "lodash");
	assert.ok(fetched.ok);
	assert.equal(fetched.value.unpublished, false);
	assert.equal(fetched.value.times["4.17.21"], "2025-01-01T00:00:00.000Z");
	assert.equal(fetched.value.versions["4.17.21"]?.deprecated, true);
	assert.equal(fetched.value.versions["4.17.21"]?.license, "MIT");
	assert.equal(fetched.value.versions["4.17.21"]?.engines, ">=24");
});

test("[§4.8.2] registry 404 means unpublished, not transport failure", async () => {
	const fetched = await fetchNpmPackument(new FakeNet(), "nope");
	assert.ok(fetched.ok && fetched.value.unpublished);
});

test("[§4.8.8] registry 429 retries twice then fails CDX-E401", async () => {
	const net = new FakeNet();
	net.route("GET", "https://registry.npmjs.org/lodash", {
		status: 429,
		headers: {},
		body: "slow",
	});
	const delays: Array<number> = [];
	const fetched = await fetchNpmPackument(net, "lodash", {
		sleep: (ms) => {
			delays.push(ms);
			return Promise.resolve();
		},
	});
	assert.ok(!fetched.ok && fetched.error.code === "CDX-E401");
	assert.equal(net.requests.length, 3);
	assert.deepEqual(delays, [1000, 4000]);
	assert.equal(isRetryableStatus(429), true);
	assert.equal(isRetryableStatus(503), true);
	assert.equal(isRetryableStatus(400), false);
});

test("[§4.8.8] registry 4xx fails without retry", async () => {
	const net = new FakeNet();
	net.route("GET", "https://registry.npmjs.org/lodash", {
		status: 400,
		headers: {},
		body: "bad",
	});
	const fetched = await fetchNpmPackument(net, "lodash");
	assert.ok(!fetched.ok && fetched.error.code === "CDX-E401");
	assert.equal(net.requests.length, 1);
});

test("[§4.8.8] registry retry recovers on the second attempt", async () => {
	const net = new FakeNet();
	net.route("GET", "https://registry.npmjs.org/lodash", {
		status: 200,
		headers: {},
		body: JSON.stringify({ time: {}, versions: {} }),
	});
	const fetched = await fetchNpmPackument(net, "lodash", {
		sleep: () => Promise.resolve(),
	});
	assert.ok(fetched.ok);
});

test("[§4.8.2] OSV querybatch narrows ids and ranges", async () => {
	const net = new FakeNet();
	net.route("POST", "https://api.osv.dev/v1/querybatch", {
		status: 200,
		headers: {},
		body: JSON.stringify({
			results: [{ vulns: [{ id: "GHSA-1" }, { id: "GHSA-1" }] }],
		}),
	});
	const ids = await fetchOsvAdvisoryIds(net, "npm", "lodash", "4.17.20");
	assert.ok(ids.ok);
	assert.deepEqual(ids.value, ["GHSA-1"]);
	net.route("GET", "https://api.osv.dev/v1/vulns/GHSA-1", {
		status: 200,
		headers: {},
		body: JSON.stringify({
			affected: [
				{
					ranges: [
						{ type: "SEMVER", events: [{ introduced: "0", fixed: "4.17.21" }] },
					],
				},
			],
		}),
	});
	const ranges = await fetchOsvRanges(net, "GHSA-1");
	assert.ok(ranges.ok);
	assert.equal(osvAdvisoryAffects(ranges.value, "4.17.20"), true);
	assert.equal(osvAdvisoryAffects(ranges.value, "4.17.21"), false);
});

test("[§4.8.2] OSV retry and malformed bodies fail closed", async () => {
	const net = new FakeNet();
	net.route("POST", "https://api.osv.dev/v1/querybatch", {
		status: 503,
		headers: {},
		body: "down",
	});
	const failed = await fetchOsvAdvisoryIds(net, "npm", "a", "1.0.0", {
		sleep: () => Promise.resolve(),
		retries: 1,
	});
	assert.ok(!failed.ok && failed.error.code === "CDX-E401");
	assert.equal(net.requests.length, 2);
	net.route("GET", "https://api.osv.dev/v1/vulns/GHSA-9", {
		status: 200,
		headers: {},
		body: "{oops",
	});
	const malformed = await fetchOsvRanges(net, "GHSA-9");
	assert.equal(malformed.ok, false);
	assert.deepEqual(narrowOsvRanges({ nope: 1 }), []);
});

test("[§4.8.8] OSV ranges cover last_affected and open intervals", () => {
	assert.deepEqual(
		narrowOsvRanges({ affected: [{ ranges: [{ type: "X", events: "no" }] }] }),
		[{ type: "X", events: [] }],
	);
	assert.equal(
		osvAdvisoryAffects(
			[
				{
					type: "SEMVER",
					events: [
						{ introduced: "1.0.0", fixed: undefined, lastAffected: "1.0.5" },
					],
				},
			],
			"1.0.5",
		),
		true,
	);
	assert.equal(
		osvAdvisoryAffects(
			[
				{
					type: "SEMVER",
					events: [
						{ introduced: "9.0.0", fixed: undefined, lastAffected: undefined },
					],
				},
			],
			"1.0.0",
		),
		false,
	);
	assert.equal(osvAdvisoryAffects([], "1.0.0"), false);
});

test("[§4.8.4] snapshot freshness gates reuse per layer", () => {
	const table = snapshot(["4.17.21"]);
	assert.equal(snapshotFreshness(table, FIXED_INSTANT), "fresh");
	assert.equal(snapshotFreshness(table, "2026-02-01T00:00:00.000Z"), "stale");
	assert.equal(snapshotFreshness(undefined, FIXED_INSTANT), "missing");
	assert.equal(snapshotFreshness(table, "bogus"), "missing");
	assert.equal(snapshotAsOf(table), `as of ${FIXED_INSTANT}`);
	const hashed = hashSnapshot(table);
	assert.equal(hashSnapshot(table), hashed);
	assert.equal(typeof hashed, "string");
});

test("[§4.8.5] vulnerable pins name the fix and latest stable", () => {
	const table: RegistrySnapshot = {
		version: 1,
		ecosystem: "npm",
		fetchedAt: FIXED_INSTANT,
		packages: {
			lodash: {
				versions: {
					"4.17.20": { published: "2025-01-01T00:00:00.000Z", license: "MIT" },
					"4.17.21": { published: "2025-02-01T00:00:00.000Z", license: "MIT" },
					"5.0.0": { published: "2025-03-01T00:00:00.000Z", license: "MIT" },
				},
			},
		},
		advisories: { "lodash@4.17.20": ["GHSA-x"] },
	};
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "lodash", range: "4.17.20", kind: "prod" }],
			},
		],
		snapshot: table,
		now: FIXED_INSTANT,
	});
	const vuln = evaluated.findings.find(
		(finding) => finding.ruleId === "core/dep-no-vulnerable",
	);
	assert.ok(vuln !== undefined);
	assert.ok(vuln.remediation.includes("4.17.21"));
	assert.ok(vuln.remediation.includes("5.0.0"));
});

test("[§4.8.5] deprecated and unpublished pins block", () => {
	const table: RegistrySnapshot = {
		version: 1,
		ecosystem: "npm",
		fetchedAt: FIXED_INSTANT,
		packages: {
			old: {
				versions: {
					"1.0.0": { published: "2025-01-01T00:00:00.000Z", deprecated: true },
				},
			},
		},
		advisories: {},
	};
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [
					{ name: "old", range: "1.0.0", kind: "prod" },
					{ name: "gone", range: "1.0.0", kind: "prod" },
				],
			},
		],
		unpublished: ["gone"],
		snapshot: table,
		now: FIXED_INSTANT,
	});
	assert.equal(
		evaluated.findings.filter(
			(finding) => finding.ruleId === "core/dep-no-deprecated",
		).length,
		2,
	);
});

test("[§4.8.5] lag past the bound blocks with a countdown before", () => {
	const table = snapshot(["4.17.20"], "2024-01-01T00:00:00.000Z");
	const stale: RegistrySnapshot = {
		...table,
		packages: {
			lodash: {
				versions: {
					"4.17.20": { published: "2024-01-01T00:00:00.000Z", license: "MIT" },
					"4.17.21": { published: "2025-01-01T00:00:00.000Z", license: "MIT" },
				},
			},
		},
	};
	const blocked = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "lodash", range: "4.17.20", kind: "prod" }],
			},
		],
		snapshot: stale,
		now: FIXED_INSTANT,
	});
	assert.ok(
		blocked.findings.some(
			(finding) => finding.ruleId === "core/dep-latest-stable",
		),
	);
	const fresh: RegistrySnapshot = {
		...table,
		fetchedAt: "2025-01-25T00:00:00.000Z",
		packages: {
			lodash: {
				versions: {
					"4.17.20": { published: "2025-01-01T00:00:00.000Z", license: "MIT" },
					"4.17.21": { published: "2025-01-15T00:00:00.000Z", license: "MIT" },
				},
			},
		},
	};
	const passing = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "lodash", range: "4.17.20", kind: "prod" }],
			},
		],
		snapshot: fresh,
		now: "2025-01-25T00:00:00.000Z",
	});
	assert.ok(
		passing.findings.every(
			(finding) => finding.ruleId !== "core/dep-latest-stable",
		),
	);
	assert.ok(passing.notes.some((note) => note.includes("blocks in")));
});

test("[§4.8.5] licenses outside the policy block", () => {
	const table: RegistrySnapshot = {
		version: 1,
		ecosystem: "npm",
		fetchedAt: FIXED_INSTANT,
		packages: {
			lodash: {
				versions: {
					"4.17.21": {
						published: "2025-01-01T00:00:00.000Z",
						license: "GPL-3.0",
					},
				},
			},
		},
		advisories: {},
	};
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "lodash", range: "4.17.21", kind: "prod" }],
			},
		],
		snapshot: table,
		now: FIXED_INSTANT,
	});
	assert.ok(
		evaluated.findings.some((finding) => finding.ruleId === "core/dep-license"),
	);
});

test("[§4.8.5] capability duplicates block once per package", () => {
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "packages/a/package.json",
				dependencies: [{ name: "prettier", range: "3.0.0", kind: "dev" }],
			},
			{
				path: "packages/b/package.json",
				dependencies: [{ name: "@biomejs/biome", range: "2.0.0", kind: "dev" }],
			},
		],
		now: FIXED_INSTANT,
	});
	const caps = evaluated.findings.filter(
		(finding) => finding.ruleId === "core/dep-one-per-capability",
	);
	assert.equal(caps.length, 1);
	assert.ok(caps[0]?.remediation.includes("format"));
});

test("[§4.8.5] lockfile verdicts need the lockfile in scope", () => {
	const missing = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "a", range: "1.0.0", kind: "prod" }],
			},
		],
		lockfiles: { "package.json": null },
		now: FIXED_INSTANT,
	});
	assert.ok(
		missing.findings.some((finding) => finding.ruleId === "core/dep-lockfile"),
	);
	const unparseable = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "a", range: "1.0.0", kind: "prod" }],
			},
		],
		lockfiles: { "package.json": "{oops" },
		now: FIXED_INSTANT,
	});
	assert.ok(
		unparseable.findings.some(
			(finding) => finding.ruleId === "core/dep-lockfile",
		),
	);
	const synced = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "a", range: "1.0.0", kind: "prod" }],
			},
		],
		lockfiles: {
			"package.json": JSON.stringify({
				lockfileVersion: 3,
				packages: { "": { dependencies: { a: "1.0.0" } } },
			}),
		},
		now: FIXED_INSTANT,
	});
	assert.ok(
		synced.findings.every((finding) => finding.ruleId !== "core/dep-lockfile"),
	);
});

test("[§4.8.5] new dependencies need a recorded reason", () => {
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "fresh", range: "1.0.0", kind: "prod" }],
			},
		],
		newDeps: ["fresh"],
		now: FIXED_INSTANT,
	});
	assert.ok(
		evaluated.findings.some(
			(finding) => finding.ruleId === "core/dep-new-needs-reason",
		),
	);
	const excused = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "fresh", range: "1.0.0", kind: "prod" }],
			},
		],
		newDeps: ["fresh"],
		addedReasons: { fresh: true },
		now: FIXED_INSTANT,
	});
	assert.ok(
		excused.findings.every(
			(finding) => finding.ruleId !== "core/dep-new-needs-reason",
		),
	);
});

test("[§4.8.8] private registries need an allowlist entry", () => {
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "a", range: "1.0.0", kind: "prod" }],
			},
		],
		npmrc: { path: ".npmrc", text: "@acme:registry=https://npm.acme.test/\n" },
		now: FIXED_INSTANT,
	});
	assert.ok(evaluated.findings.some((finding) => finding.code === "CDX-E702"));
	const allowed = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "a", range: "1.0.0", kind: "prod" }],
			},
		],
		npmrc: { path: ".npmrc", text: "@acme:registry=https://npm.acme.test/\n" },
		allowedRegistryHosts: ["npm.acme.test"],
		now: FIXED_INSTANT,
	});
	assert.ok(allowed.findings.every((finding) => finding.code !== "CDX-E702"));
	const exact = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [{ name: "a", range: "1.0.0", kind: "prod" }],
			},
		],
		npmrc: { path: ".npmrc", text: "save-exact=false\n" },
		saveExactRequired: true,
		now: FIXED_INSTANT,
	});
	assert.ok(
		exact.findings.some((finding) => finding.ruleId === "core/dep-exact-pin"),
	);
});

test("[§4.8.5] unversioned sources skip latest-stable with a note", () => {
	const sha = "b".repeat(40);
	const evaluated = evaluateDepVerdicts({
		manifests: [
			{
				path: "package.json",
				dependencies: [
					{
						name: "r",
						range: `git+https://example.com/r.git#${sha}`,
						kind: "prod",
					},
				],
			},
		],
		snapshot: snapshot([]),
		now: FIXED_INSTANT,
	});
	assert.ok(evaluated.findings.length === 0);
	assert.ok(
		evaluated.notes.some((note) => note.includes("unversioned source")),
	);
});

test("[§4.8.6] bot detection names renovate dependabot or codictator", () => {
	assert.equal(detectUpgradeBots(["renovate.json", "a.ts"]), "renovate");
	assert.equal(detectUpgradeBots([".github/renovate.json5"]), "renovate");
	assert.equal(detectUpgradeBots([".github/dependabot.yml"]), "dependabot");
	assert.equal(detectUpgradeBots(["package.json"]), "codictator");
	assert.equal(
		detectUpgradeBots(["renovate.json", ".github/dependabot.yml"]),
		"renovate",
	);
});

test("[§4.8.6] renovate drift flags owned keys until regen", () => {
	const drifted = checkRenovateOwnedKeys(
		"renovate.json",
		JSON.stringify({ rangeStrategy: "bump", extends: ["config:base"] }),
		7,
	);
	assert.ok(drifted.some((finding) => finding.ruleId === "core/dep-exact-pin"));
	assert.ok(
		drifted.some((finding) => finding.ruleId === "core/dep-no-vulnerable"),
	);
	const clean = checkRenovateOwnedKeys(
		"renovate.json",
		JSON.stringify({
			rangeStrategy: "pin",
			extends: ["config:base", "helpers:pinGitHubActionDigests"],
			osvVulnerabilityAlerts: true,
			vulnerabilityAlerts: { minimumReleaseAge: null },
		}),
		7,
	);
	assert.deepEqual(clean, []);
	assert.deepEqual(checkRenovateOwnedKeys("renovate.json", "{oops", 7), []);
});

test("[§4.8.6] dependabot entries carry schedule cooldown and strategy", () => {
	const text = [
		"version: 2",
		"updates:",
		"  - package-ecosystem: npm",
		"    directory: /",
		"    schedule:",
		"      interval: daily",
		"    cooldown:",
		"      default-days: 7",
		"    versioning-strategy: increase",
		"  - package-ecosystem: github-actions",
		"    directory: /",
		"    schedule:",
		"      interval: daily",
		"    cooldown:",
		"      default-days: 7",
	].join("\n");
	assert.deepEqual(
		checkDependabotOwnedKeys(".github/dependabot.yml", text, ["npm"], 7),
		[],
	);
	const missing = checkDependabotOwnedKeys(
		".github/dependabot.yml",
		"version: 2\n",
		["npm"],
		7,
	);
	assert.ok(
		missing.some((finding) => finding.message.includes("no updates entry")),
	);
	const slack = checkDependabotOwnedKeys(
		".github/dependabot.yml",
		text.replace("interval: daily", "interval: weekly"),
		["npm"],
		7,
	);
	assert.ok(slack.some((finding) => finding.message.includes("weekly")));
});

test("[§4.8.6] upgrade branches group patch and minor of one line", () => {
	assert.equal(
		upgradeBranchName("npm", "lodash", "4.17.21"),
		"codictator/deps/npm/lodash-4.17.21",
	);
});

test("[§6.1] toolchain files parse to exact toolchain pins", async () => {
	const { parseToolchainFiles, isExactToolchainPin } = await import(
		"../../../src/features/deps/index.ts"
	);
	const toolchains = parseToolchainFiles("v24.1.0\n", "npm@11.0.0");
	assert.equal(toolchains.length, 2);
	assert.ok(toolchains.every((entry) => entry.kind === "toolchain"));
	assert.ok(toolchains.every((entry) => isExactToolchainPin(entry.range)));
	assert.equal(isExactToolchainPin("^24.0.0"), false);
	assert.equal(isExactToolchainPin("npm@^11.0.0"), false);
	assert.deepEqual(parseToolchainFiles(undefined, undefined), []);
});

test("[§4.8.6] bot file predicates match known names", async () => {
	const { isRenovateFile, isDependabotFile } = await import(
		"../../../src/features/deps/index.ts"
	);
	assert.equal(isRenovateFile(".renovaterc"), true);
	assert.equal(isRenovateFile("package.json"), false);
	assert.equal(isDependabotFile(".github/dependabot.yml"), true);
	assert.equal(isDependabotFile("renovate.json"), false);
});

test("[§4.8.6] platform covers name the pinned replacement", async () => {
	const { platformCapabilityCover, NPM_ECOSYSTEM } = await import(
		"../../../src/features/deps/index.ts"
	);
	assert.equal(platformCapabilityCover("unique-ids"), "crypto.randomUUID");
	assert.equal(platformCapabilityCover("dates"), undefined);
	assert.equal(NPM_ECOSYSTEM, "npm");
});

test("[§4.8.4] snapshot building keeps the cache path and hash", async () => {
	const { buildSnapshot, hashSnapshot, SNAPSHOT_CACHE_PATH } = await import(
		"../../../src/features/deps/index.ts"
	);
	assert.ok(SNAPSHOT_CACHE_PATH.endsWith("npm.json"));
	const built = buildSnapshot(
		"npm",
		FIXED_INSTANT,
		[
			{
				name: "a",
				unpublished: false,
				times: { "1.0.0": FIXED_INSTANT },
				versions: {},
			},
			{
				name: "b",
				unpublished: false,
				times: { "1.0.0": FIXED_INSTANT },
				versions: {
					"1.0.0": { deprecated: false, license: "MIT", engines: ">=24" },
				},
			},
		],
		{},
	);
	assert.deepEqual(Object.keys(built.packages), ["a", "b"]);
	assert.equal(typeof hashSnapshot(built), "string");
});

test("[§4.8.5] error findings carry the blocking code", async () => {
	const { depErrorFinding, makeDepError } = await import(
		"../../../src/features/deps/index.ts"
	);
	const error = makeDepError("CDX-E401", "gone", "retry");
	const finding = depErrorFinding("core/dep-lockfile", "p", error, "fix");
	assert.equal(finding.code, "CDX-E401");
	assert.equal(finding.remediation, "fix");
});

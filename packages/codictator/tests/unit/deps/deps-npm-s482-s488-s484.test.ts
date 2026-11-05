import { strict as assert } from "node:assert";

import test from "node:test";

import {
	fetchOsvAdvisoryIds,
	fetchOsvRanges,
	hashSnapshot,
	narrowOsvRanges,
	osvAdvisoryAffects,
	type RegistrySnapshot,
	snapshotAsOf,
	snapshotFreshness,
} from "../../../src/features/deps/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { FakeNet } from "../../support/fake-net.ts";

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

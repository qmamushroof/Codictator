import { strict as assert } from "node:assert";

import test from "node:test";

import {
	fetchNpmPackument,
	isExactNpmPin,
	isRetryableStatus,
	lockfileMismatches,
	parseNpmrc,
	parsePackageJson,
	parsePackageLock,
	privateRegistryHosts,
} from "../../../src/features/deps/index.ts";

import { FakeNet } from "../../support/fake-net.ts";

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

import { strict as assert } from "node:assert";

import test from "node:test";

import {
	checkDependabotOwnedKeys,
	checkRenovateOwnedKeys,
	detectUpgradeBots,
	evaluateDepVerdicts,
	type RegistrySnapshot,
	upgradeBranchName,
} from "../../../src/features/deps/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

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

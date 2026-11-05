import { strict as assert } from "node:assert";

import test from "node:test";

import { evaluateDepVerdicts } from "../../../src/features/deps/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

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

import { strict as assert } from "node:assert";

import test from "node:test";

import {
	evaluateDepVerdicts,
	type RegistrySnapshot,
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

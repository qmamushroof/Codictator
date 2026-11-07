import { strict as assert } from "node:assert";

import test from "node:test";

import type { Config } from "../../../src/features/config/index.ts";

import { validateConfig } from "../../../src/features/config/index.ts";

function baseConfig(): Config {
	return {
		version: 1,
		codictator: "unknown",
		packs: [{ id: "core" }],
		harnesses: ["universal"],
		tunables: {},
		architecture: undefined,
		workflow: undefined,
		spec: undefined,
		testing: undefined,
		commands: {},
		steering: undefined,
		tools: [],
		security: undefined,
		deps: undefined,
		network: undefined,
		integrity: undefined,
		ci: undefined,
		llm: undefined,
	};
}

async function errorCodeOf(call: () => unknown): Promise<string> {
	try {
		await call();
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error) {
			const code: unknown = error.code;
			if (typeof code === "string") {
				return code;
			}
		}
		return "threw-without-code";
	}
	return "did-not-throw";
}

test("[§4.2] floor rule under tunables is CDX-E103", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/no-bypass": { params: {} } },
			}),
		),
		"CDX-E103",
	);
});

test("[§4.2] tunables params that are not an object is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/file-size": { params: 42 } },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] tunables inline params without the wrapper are accepted", () => {
	const effective = validateConfig({
		...baseConfig(),
		tunables: { "core/file-size": { maxLines: 300 } },
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] tunable parameter the rule does not declare is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/file-size": { params: { maxBogus: 1 } } },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] numeric tunable with a string value is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/file-size": { params: { maxLines: "many" } } },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] numeric tunable with NaN is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: {
					"core/file-size": { params: { maxLines: Number.NaN } },
				},
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] numeric tunable below zero is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/file-size": { params: { maxLines: -1 } } },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] numeric tunable looser than the default is CDX-E104", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/file-size": { params: { maxLines: 999 } } },
			}),
		),
		"CDX-E104",
	);
});

test("[§4.2] higher-stricter tunable tightens above the default", () => {
	const effective = validateConfig({
		...baseConfig(),
		tunables: {
			"core/dep-latest-stable": { params: { minReleaseAgeDays: 30 } },
		},
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] higher-stricter tunable looser than the default is CDX-E104", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: {
					"core/dep-latest-stable": { params: { minReleaseAgeDays: 3 } },
				},
			}),
		),
		"CDX-E104",
	);
});

test("[§4.2] set tunable with a non-array value is CDX-E101", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: { "core/doc-placement": { params: { allowedGlobs: "x" } } },
			}),
		),
		"CDX-E101",
	);
});

test("[§4.2] subset set tunable with an extra entry is CDX-E104", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: {
					"core/doc-placement": { params: { allowedGlobs: ["docs/**"] } },
				},
			}),
		),
		"CDX-E104",
	);
});

test("[§4.2] superset set tunable keeps its defaults accepted", () => {
	const effective = validateConfig({
		...baseConfig(),
		tunables: {
			"core/agent-assets-present": {
				params: { requiredHelpers: ["knowledge-graph", "token-saver"] },
			},
		},
	});
	assert.equal(typeof effective.configHash, "string");
});

test("[§4.2] superset set tunable dropping a default is CDX-E104", async () => {
	assert.equal(
		await errorCodeOf(() =>
			validateConfig({
				...baseConfig(),
				tunables: {
					"core/agent-assets-present": {
						params: { requiredHelpers: ["knowledge-graph"] },
					},
				},
			}),
		),
		"CDX-E104",
	);
});

test("[§4.2] policy tunable skips value checks", () => {
	const effective = validateConfig({
		...baseConfig(),
		tunables: { "core/dep-license": { params: { allow: ["MIT"] } } },
	});
	assert.equal(typeof effective.configHash, "string");
});
